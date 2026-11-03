import { config } from './config.js';
import { askAI } from './llm.js';
import { resolveVoice, textToSpeech } from './fishaudio.js';
import { describeActivity, speakableName } from './text.js';
import { warnInTerminal } from './errors.js';
import { playInChannel } from './voice.js';

// When each member was last greeted or roasted on the way out, so hopping in and out (or a flaky connection) doesn't spam.
const lastGreeted = new Map();
const lastRoasted = new Map();

// What the bot knows about each friend (keyed by Discord username), so their greeting can rib them about it.
const friendBits = {
  gamebredray: 'is obsessed with K-pop and anything from Asia: idols, anime, boba, K-dramas',
  stickygravy: 'is still hooked on MapleStory and eats leftover rice every single day',
  pparkerr: 'loves Teslas, makes constant impulse purchases, and is a huge Sabrina Carpenter fan',
  jig4352: "is a proper Brexit geezer: Union Jack, pints down the pub, moaning about Brussels. Mock the Brexit bloke act, but don't make racist jokes",
};

/** What to call the member out loud: server nickname, then display name, then username. */
function nameFor(member) {
  return speakableName(member.nickname) ?? speakableName(member.user.globalName) ?? speakableName(member.user.username) ?? 'my friend';
}

function onCooldown(member, lastAt) {
  const key = `${member.guild.id}:${member.id}`;
  const now = Date.now();
  const cooldownMs = config.greetCooldownMinutes * 60_000;
  if (now - (lastAt.get(key) ?? 0) < cooldownMs) return true;
  lastAt.set(key, now);
  if (lastAt.size > 1000) {
    for (const [k, at] of lastAt) if (now - at >= cooldownMs) lastAt.delete(k);
  }
  return false;
}

/** Roast material for the prompt: sometimes what they're doing right now, otherwise their friend bit. */
function roastMaterial(member) {
  const activity = Math.random() * 100 < config.greetActivityChance ? describeActivity(member.presence?.activities) : null;
  if (activity) return `They're ${activity} right now; make fun of that. `;
  const bit = friendBits[member.user.username.toLowerCase()];
  return bit ? `They ${bit}; work that into the dig. ` : '';
}

/** Writes a line with the AI and says it in the greeting voice, unless shouldPlay() says it's no longer wanted. */
async function speakInChannel(channel, prompt, shouldPlay) {
  const voice = await resolveVoice(config.greetVoice);
  if (!voice) return console.error(`[greet] No Fish Audio voice found for GREET_VOICE="${config.greetVoice}"`);
  const line = await askAI(prompt + 'One short sentence, under 20 words. Playful ribbing between friends, not genuinely mean.', {
    voiceName: voice.name,
  });
  const mp3 = await textToSpeech(line, voice.id);
  if (!shouldPlay()) return;
  // Joins, or switches over from another channel, once anything already playing has finished.
  await playInChannel(channel, mp3);
}

/** Handles Events.VoiceStateUpdate: greets a member who just joined (or moved into) a voice channel. */
export async function greetOnJoin(oldState, newState) {
  const channel = newState.channel;
  const member = newState.member;
  if (!config.greetings || !channel || !member || member.user.bot) return;
  if (oldState.channelId === newState.channelId) return; // Mute, deafen, stream etc., not a join.
  if (channel.id === channel.guild.afkChannelId || !channel.joinable) return;
  if (onCooldown(member, lastGreeted)) return;

  try {
    await speakInChannel(
      channel,
      `"${nameFor(member)}" just joined the voice channel. Greet them by that name with a sarcastic, backhanded welcome, in character. ` +
        roastMaterial(member),
      // They may have left while the greeting was being made.
      () => member.voice.channelId === channel.id,
    );
  } catch (err) {
    console.error(`[greet] Couldn't greet ${member.user.tag}:`, err.message);
    warnInTerminal(err);
  }
}

/** People (not bots) still in the channel, who'd hear a roast. */
function listeners(channel) {
  return channel.members.filter((m) => !m.user.bot);
}

/** Handles Events.VoiceStateUpdate: sometimes roasts a member who disconnected, to whoever's still in the channel. */
export async function roastOnLeave(oldState, newState) {
  const channel = oldState.channel;
  const member = oldState.member;
  // Only full disconnects: moving to another channel gets a greeting over there instead.
  if (!channel || newState.channelId || !member || member.user.bot) return;
  if (channel.id === channel.guild.afkChannelId || !channel.joinable || !listeners(channel).size) return;
  if (Math.random() * 100 >= config.leaveRoastChance) return;
  if (onCooldown(member, lastRoasted)) return;

  try {
    await speakInChannel(
      channel,
      `"${nameFor(member)}" just left the voice channel. Roast them by name to the people still there, in character, ` +
        'like they rage quit or bailed on everyone. ' +
        roastMaterial(member),
      // Nobody left to hear it.
      () => listeners(channel).size > 0,
    );
  } catch (err) {
    console.error(`[greet] Couldn't roast ${member.user.tag} for leaving:`, err.message);
    warnInTerminal(err);
  }
}
