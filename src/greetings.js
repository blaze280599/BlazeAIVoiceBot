import { config } from './config.js';
import { askAI } from './llm.js';
import { resolveVoice, textToSpeech } from './fishaudio.js';
import { speakableName } from './text.js';
import { warnInTerminal } from './errors.js';
import { playInChannel } from './voice.js';

// When each member was last greeted, so hopping in and out (or a flaky connection) doesn't spam greetings.
const lastGreeted = new Map();

/** What to call the member out loud: server nickname, then display name, then username. */
function nameFor(member) {
  return speakableName(member.nickname) ?? speakableName(member.user.globalName) ?? speakableName(member.user.username) ?? 'my friend';
}

function onCooldown(member) {
  const key = `${member.guild.id}:${member.id}`;
  const now = Date.now();
  const cooldownMs = config.greetCooldownMinutes * 60_000;
  if (now - (lastGreeted.get(key) ?? 0) < cooldownMs) return true;
  lastGreeted.set(key, now);
  if (lastGreeted.size > 1000) {
    for (const [k, at] of lastGreeted) if (now - at >= cooldownMs) lastGreeted.delete(k);
  }
  return false;
}

/** Handles Events.VoiceStateUpdate: greets a member who just joined (or moved into) a voice channel. */
export async function greetOnJoin(oldState, newState) {
  const channel = newState.channel;
  const member = newState.member;
  if (!config.greetings || !channel || !member || member.user.bot) return;
  if (oldState.channelId === newState.channelId) return; // Mute, deafen, stream etc., not a join.
  if (channel.id === channel.guild.afkChannelId || !channel.joinable) return;
  if (onCooldown(member)) return;

  const name = nameFor(member);
  try {
    const voice = await resolveVoice(config.greetVoice);
    if (!voice) return console.error(`[greet] No Fish Audio voice found for GREET_VOICE="${config.greetVoice}"`);
    const greeting = await askAI(
      `"${name}" just joined the voice channel. Greet them by that name, warmly and in character, in one or two short sentences.`,
      { voiceName: voice.name },
    );
    const mp3 = await textToSpeech(greeting, voice.id);
    // They may have left while the greeting was being made.
    if (member.voice.channelId !== channel.id) return;
    // Joins, or switches over from another channel, once anything already playing has finished.
    await playInChannel(channel, mp3);
  } catch (err) {
    console.error(`[greet] Couldn't greet ${member.user.tag}:`, err.message);
    warnInTerminal(err);
  }
}
