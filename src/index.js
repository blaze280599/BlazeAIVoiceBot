import { AttachmentBuilder, Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { askAI } from './llm.js';
import { getVoice, resolveVoice, searchVoices, textToSpeech } from './fishaudio.js';
import { extractVoiceId, stripCues } from './text.js';
import { clearUserVoice, getUserVoice, setUserVoice } from './userVoices.js';
import { ServiceError, warnInTerminal } from './errors.js';
import { leaveChannel, playInChannel } from './voice.js';
import { greetOnJoin } from './greetings.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  // User text and AI answers are echoed into chat, so never let them ping @everyone, roles or users.
  allowedMentions: { parse: [] },
});

client.once(Events.ClientReady, (c) => console.log(`Logged in as ${c.user.tag}`));

client.on(Events.VoiceStateUpdate, greetOnJoin);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) return await handleVoiceAutocomplete(interaction);
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case 'ask':
        return await handleSpeak(interaction, { useAI: true });
      case 'say':
        return await handleSpeak(interaction, { useAI: false });
      case 'voices':
        return await handleVoices(interaction);
      case 'leave': {
        const left = interaction.guildId && leaveChannel(interaction.guildId);
        return await interaction.reply({
          content: left ? 'Left the voice channel.' : "I'm not in a voice channel.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (err) {
    // Autocomplete requests expire after 3s or get replaced as the user keeps typing; nothing to do.
    if (interaction.isAutocomplete() && err.code === 10062) return;
    console.error(`Error handling ${interaction.commandName ?? 'interaction'}:`, err.message);
    warnInTerminal(err);
    if (!interaction.isRepliable()) return;
    const content = (err instanceof ServiceError ? err.friendly : `Something went wrong: ${err.message}`).slice(0, 1900);
    if (interaction.deferred || interaction.replied) {
      // The deferred reply may be public; swap it for a private message so errors don't clutter the channel.
      await interaction.deleteReply().catch(() => {});
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

function describeVoice(v) {
  return `${v.name}${v.author ? ` · by ${v.author}` : ''} · ${v.uses.toLocaleString()} uses`;
}

async function handleVoiceAutocomplete(interaction) {
  const typed = interaction.options.getFocused().trim();

  // A pasted fish.audio link or ID: show that exact voice so the user can confirm it.
  const pastedId = extractVoiceId(typed);
  if (pastedId) {
    const voice = await getVoice(pastedId).catch((err) => {
      console.error('Voice lookup failed:', err.message);
      return undefined;
    });
    if (voice === undefined) return interaction.respond([]);
    return interaction.respond(
      voice
        ? [{ name: `🔗 ${describeVoice(voice)}`.slice(0, 100), value: voice.id }]
        : [{ name: 'No Fish Audio voice found for that link/ID', value: pastedId }],
    );
  }

  // Discord drops autocomplete responses after 3 seconds, so don't wait on a slow search.
  const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 2500));
  const voices = await Promise.race([
    searchVoices(typed).catch((err) => {
      console.error('Voice search failed:', err.message);
      return [];
    }),
    timeout,
  ]);
  await interaction.respond(voices.slice(0, 25).map((v) => ({ name: describeVoice(v).slice(0, 100), value: v.id })));
}

// When each user last ran /ask or /say, so one person can't burn through the API credits.
const lastSpoke = new Map();

/** Returns the seconds left on the user's cooldown, or 0 (and starts a new cooldown) if they can go. */
function cooldownLeft(userId) {
  const now = Date.now();
  const cooldownMs = config.cooldownSeconds * 1000;
  const waitMs = (lastSpoke.get(userId) ?? 0) + cooldownMs - now;
  if (waitMs > 0) return Math.ceil(waitMs / 1000);
  lastSpoke.set(userId, now);
  // Forget expired entries now and then so the map doesn't grow forever.
  if (lastSpoke.size > 1000) {
    for (const [id, at] of lastSpoke) if (now - at >= cooldownMs) lastSpoke.delete(id);
  }
  return 0;
}

async function handleSpeak(interaction, { useAI }) {
  const wait = cooldownLeft(interaction.user.id);
  if (wait) {
    return interaction.reply({ content: `⏳ Slow down! Try again in ${wait}s.`, flags: MessageFlags.Ephemeral });
  }

  const input = interaction.options.getString(useAI ? 'question' : 'text', true);
  const voiceInput = interaction.options.getString('voice');
  const speakOption = interaction.options.getBoolean('speak');

  // Voice states are cached thanks to the GuildVoiceStates intent, so this is instant.
  const voiceChannel = interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channel ?? null;
  const shouldSpeak = speakOption ?? Boolean(voiceChannel);
  const playing = Boolean(shouldSpeak && voiceChannel);

  // The AI + Fish Audio takes longer than Discord's 3-second reply window.
  // When the answer is spoken in voice chat, keep the reply private so the text channel stays clean.
  await interaction.deferReply(playing ? { flags: MessageFlags.Ephemeral } : {});

  // Voice picked in this command > the user's /voices use: choice > the server default.
  const saved = await getUserVoice(interaction.user.id);
  const voice = await resolveVoice(voiceInput, { fallbackId: saved?.id });
  if (!voice) {
    return interaction.editReply(
      voiceInput
        ? `I couldn't find a voice for "${voiceInput}". Try \`/voices\` or paste a fish.audio voice link.`
        : `Your saved voice${saved ? ` (**${saved.name}**)` : ''} isn't available anymore. Pick a new one with \`/voices use:\` or \`/voices reset:True\`.`,
    );
  }

  const answer = useAI ? await askAI(input, { voiceName: voice.name }) : input;
  const mp3 = await textToSpeech(answer, voice.id);

  const header = useAI ? `**Q:** ${input}\n**A** (${voice.name}): ` : `🔊 (${voice.name}): `;
  const content = header + stripCues(answer);
  const makeFile = () => new AttachmentBuilder(mp3, { name: `${voice.name.replace(/[^\w-]+/g, '_')}.mp3` });

  if (playing) {
    // Only the asker sees this, and it's removed once the bot finishes speaking.
    await interaction.editReply(`🔊 Speaking in ${voiceChannel} as **${voice.name}**…`);

    playInChannel(voiceChannel, mp3)
      .then(() => interaction.deleteReply().catch(() => {}))
      .catch(async (err) => {
        console.error('Voice playback failed:', err);
        // Fall back to the MP3 (still private) so the answer isn't lost.
        await interaction
          .editReply({
            content: `Couldn't play in ${voiceChannel} (${err.message}), here's the audio instead.\n\n${content}`.slice(0, 2000),
            files: [makeFile()],
          })
          .catch(() => {});
      });
    return;
  }

  // Not in a voice channel (or speak:false): attach the MP3 instead.
  const note = shouldSpeak ? '\n-# Join a voice channel and I\'ll say it out loud next time.' : '';
  await interaction.editReply({ content: content.slice(0, 2000 - note.length) + note, files: [makeFile()] });
}

async function handleVoices(interaction) {
  const use = interaction.options.getString('use');
  const reset = interaction.options.getBoolean('reset') ?? false;
  const search = interaction.options.getString('search') ?? '';
  const mine = interaction.options.getBoolean('mine') ?? false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (reset) {
    await clearUserVoice(interaction.user.id);
    const fallback = await resolveVoice(null);
    return interaction.editReply(`Reset. I'll use the default voice, **${fallback?.name ?? 'unknown'}**, for you.`);
  }

  if (use) {
    const voice = await resolveVoice(use);
    if (!voice) return interaction.editReply(`I couldn't find a voice for "${use}". Paste a fish.audio voice link or search by name.`);
    await setUserVoice(interaction.user.id, voice);
    return interaction.editReply(
      `Your voice is now **${voice.name}** (\`${voice.id}\`). \`/ask\` and \`/say\` will use it unless you pick another voice in the command.`,
    );
  }

  const voices = await searchVoices(search, { mine });
  if (!voices.length) return interaction.editReply(search ? `No voices found for "${search}".` : 'No voices found.');

  const lines = voices.map((v) => `• **${v.name}** — ${v.uses.toLocaleString()} uses · \`${v.id}\``);
  const title = search ? `Top voices for "${search}"` : mine ? 'Your voices' : 'Most popular voices';
  const saved = await getUserVoice(interaction.user.id);
  let content = saved ? `Your current voice: **${saved.name}** (change it with \`/voices use:\`)\n\n` : '';
  content += `**${title}** (use the \`voice\` option on \`/ask\` or \`/say\`, or \`/voices use:\`):\n`;
  for (const line of lines) {
    if (content.length + line.length + 1 > 1950) {
      content += '\n…and more. Start typing in the `voice` option to search.';
      break;
    }
    content += `${line}\n`;
  }
  await interaction.editReply(content);
}

client.login(config.discordToken);
