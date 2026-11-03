import { config } from './config.js';
import { askAI } from './llm.js';
import { resolveVoice, textToSpeech } from './fishaudio.js';
import { describeActivity, speakableName } from './text.js';
import { warnInTerminal } from './errors.js';
import { playInChannel } from './voice.js';

// When each member was last greeted or roasted on the way out, so hopping in and out (or a flaky connection) doesn't spam.
const lastGreeted = new Map();
const lastRoasted = new Map();
const lastReacted = new Map();
// How many times each member joined and left voice today, so the bot can make a running gag of people who keep popping in and out.
const dailyCounts = new Map();

// What the bot knows about each friend (keyed by Discord username), so their greeting can rib them about it.
const friendBits = {
  gamebredray: 'is obsessed with K-pop and anything from Asia: idols, anime, boba, K-dramas',
  stickygravy: 'is still hooked on Arena Breakout Infinite and eats leftover rice every single day',
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

/** The member's { joins, leaves } for today (the bot's local date), starting from zero each day. */
function todaysCounts(member) {
  const key = `${member.guild.id}:${member.id}`;
  const today = new Date().toDateString();
  let counts = dailyCounts.get(key);
  if (counts?.day !== today) {
    counts = { day: today, joins: 0, leaves: 0 };
    dailyCounts.set(key, counts);
    if (dailyCounts.size > 1000) {
      for (const [k, c] of dailyCounts) if (c.day !== today) dailyCounts.delete(k);
    }
  }
  return counts;
}

/** Once someone has joined or left more than once today, tells the AI the tally so it can turn it into a running gag. */
function countsMaterial({ joins, leaves }, event) {
  if ((event === 'join' ? joins : leaves) < 2) return '';
  return (
    `Today they've joined voice ${joins} ${joins === 1 ? 'time' : 'times'} and left ${leaves} ${leaves === 1 ? 'time' : 'times'}. ` +
    `Make a running gag of how often they keep ${event === 'join' ? 'coming back' : 'bailing'}, using the number. `
  );
}

/** Roast material for the prompt: sometimes what they're doing right now, otherwise their friend bit. */
function roastMaterial(member) {
  const activity = Math.random() * 100 < config.greetActivityChance ? describeActivity(member.presence?.activities) : null;
  if (activity) return `They're ${activity} right now; make fun of that. `;
  const bit = friendBits[member.user.username.toLowerCase()];
  return bit ? `They ${bit}; work that into the dig. ` : '';
}

/** People (not bots) in the channel, who'd hear the bot. */
function listeners(channel) {
  return channel.members.filter((m) => !m.user.bot);
}

/** Sometimes tells the AI who else is in the channel (and their bits), so it can play the newcomer off them. */
function groupMaterial(channel, member) {
  if (Math.random() * 100 >= config.greetGroupChance) return '';
  const others = [...listeners(channel).values()].filter((m) => m.id !== member.id).slice(0, 5);
  if (!others.length) return '';
  const who = others
    .map((m) => {
      const bit = friendBits[m.user.username.toLowerCase()];
      return bit ? `${nameFor(m)}, who ${bit}` : nameFor(m);
    })
    .join('; ');
  return `Already in the channel: ${who}. Play the newcomer off one of them by name, like the two are about to clash or team up. `;
}

/** People in the channel who can actually hear the bot (not deafened). */
function hearers(channel) {
  return listeners(channel).filter((m) => !m.voice.deaf);
}

// Voice toggles worth a reaction, checked in order: deafening also mutes, so it has to come before mute.
const voiceChanges = [
  { on: (s) => s.selfDeaf, what: "just deafened themselves, so they can't hear a thing. Roast them to everyone else for tuning the group out" },
  { on: (s) => s.streaming, what: 'just started screen sharing to the channel. Mock everyone now being forced to watch', showsActivity: true },
  { on: (s) => s.selfVideo, what: 'just turned their camera on. Rib them about everyone now having to look at them' },
  { on: (s) => s.selfMute, what: 'just muted their mic. Roast them for going quiet, like they have something to hide' },
];

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
  if (!channel || !member || member.user.bot) return;
  if (oldState.channelId === newState.channelId) return; // Mute, deafen, stream etc., not a join.
  // Counted even when the greeting is skipped (cooldown, greetings off), so the tally stays accurate.
  // Moving between channels isn't a fresh join.
  const counts = todaysCounts(member);
  if (!oldState.channelId) counts.joins++;
  if (!config.greetings) return;
  if (channel.id === channel.guild.afkChannelId || !channel.joinable) return;
  if (onCooldown(member, lastGreeted)) return;

  try {
    await speakInChannel(
      channel,
      `"${nameFor(member)}" just joined the voice channel. Greet them by that name with a sarcastic, backhanded welcome, in character. ` +
        roastMaterial(member) +
        groupMaterial(channel, member) +
        countsMaterial(counts, 'join'),
      // They may have left while the greeting was being made.
      () => member.voice.channelId === channel.id,
    );
  } catch (err) {
    console.error(`[greet] Couldn't greet ${member.user.tag}:`, err.message);
    warnInTerminal(err);
  }
}

/** Handles Events.VoiceStateUpdate: sometimes roasts a member who disconnected, to whoever's still in the channel. */
export async function roastOnLeave(oldState, newState) {
  const channel = oldState.channel;
  const member = oldState.member;
  // Only full disconnects: moving to another channel gets a greeting over there instead.
  if (!channel || newState.channelId || !member || member.user.bot) return;
  const counts = todaysCounts(member);
  counts.leaves++;
  if (channel.id === channel.guild.afkChannelId || !channel.joinable || !listeners(channel).size) return;
  if (Math.random() * 100 >= config.leaveRoastChance) return;
  if (onCooldown(member, lastRoasted)) return;

  try {
    await speakInChannel(
      channel,
      `"${nameFor(member)}" just left the voice channel. Roast them by name to the people still there, in character, ` +
        'like they rage quit or bailed on everyone. ' +
        roastMaterial(member) +
        countsMaterial(counts, 'leave'),
      // Nobody left to hear it.
      () => listeners(channel).size > 0,
    );
  } catch (err) {
    console.error(`[greet] Couldn't roast ${member.user.tag} for leaving:`, err.message);
    warnInTerminal(err);
  }
}

/** Handles Events.VoiceStateUpdate: sometimes reacts when someone deafens, mutes, goes live or turns their camera on. */
export async function reactToVoiceChange(oldState, newState) {
  const channel = newState.channel;
  const member = newState.member;
  // Only changes within a channel: joins and leaves are handled above.
  if (!channel || oldState.channelId !== newState.channelId || !member || member.user.bot) return;
  const change = voiceChanges.find((c) => !c.on(oldState) && c.on(newState));
  if (!change) return;
  if (channel.id === channel.guild.afkChannelId || !channel.joinable || !hearers(channel).size) return;
  // Joining often comes with a mute or camera toggle; don't pile a reaction on top of the greeting.
  if (Date.now() - (lastGreeted.get(`${member.guild.id}:${member.id}`) ?? 0) < 60_000) return;
  if (Math.random() * 100 >= config.voiceReactChance) return;
  if (onCooldown(member, lastReacted)) return;

  // Going live is funnier when the bot knows what they're showing.
  const activity = change.showsActivity && describeActivity(member.presence?.activities);
  try {
    await speakInChannel(
      channel,
      `"${nameFor(member)}" ${change.what}, by name, in character. ` +
        (activity ? `They're ${activity}, so that's what everyone's watching. ` : roastMaterial(member)),
      // They may have left, or everyone else deafened, while the line was being made.
      () => member.voice.channelId === channel.id && hearers(channel).size > 0,
    );
  } catch (err) {
    console.error(`[greet] Couldn't react to ${member.user.tag}'s voice change:`, err.message);
    warnInTerminal(err);
  }
}
