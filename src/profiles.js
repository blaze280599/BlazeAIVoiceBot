import { ActivityType } from 'discord.js';
import { createJsonStore } from './jsonStore.js';

// What the bot has picked up about each person, keyed by user ID: playtime per game, Spotify plays, and when they join voice.
// It only uses what anyone in the server can already see in their Discord status, never messages or voice audio.
const store = createJsonStore('profiles.json');

// The game and Spotify track each person is on right now. Kept per user rather than per server,
// so someone who shares two servers with the bot isn't counted twice.
const current = new Map();

// Playtime still in progress is added to the totals this often, so a restart loses at most a few minutes.
const CHECKPOINT_MS = 5 * 60_000;
// Presence updates come constantly, so changes are batched into one write at most this often.
const SAVE_DELAY_MS = 30_000;
// Songs and artists kept per person; past that, the least played are dropped.
const MAX_ENTRIES = 200;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

let saveTimer = null;

function scheduleSave() {
  saveTimer ??= setTimeout(async () => {
    saveTimer = null;
    try {
      await store.save(await store.load());
    } catch (err) {
      console.error('[profiles] Could not save:', err.message);
    }
  }, SAVE_DELAY_MS);
}

/** The user's profile, created the first time they're seen, or null if they opted out with /dossier tracking:False. */
async function profileFor(userId, username) {
  const profiles = await store.load();
  const profile = (profiles[userId] ??= { since: Date.now(), games: {}, artists: {}, songs: {}, joinHours: Array(24).fill(0) });
  if (profile.optedOut) return null;
  if (username) profile.name = username;
  return profile;
}

function gameStats(profile, game) {
  return (profile.games[game] ??= { minutes: 0, sessions: 0, firstSeen: Date.now() });
}

function addPlaytime(profile, game, ms) {
  const stats = gameStats(profile, game);
  stats.minutes = Math.round((stats.minutes + ms / 60_000) * 10) / 10;
}

function bump(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
  // Trim back down only once well over the limit, so a new entry isn't dropped the moment it's added.
  const keys = Object.keys(counts);
  if (keys.length > MAX_ENTRIES * 1.5) {
    for (const k of keys.sort((a, b) => counts[b] - counts[a]).slice(MAX_ENTRIES)) delete counts[k];
  }
}

/** The game and Spotify song in someone's status, if any. */
function nowPlaying(activities) {
  const game = activities.find((a) => a.type === ActivityType.Playing)?.name ?? null;
  const spotify = activities.find((a) => a.type === ActivityType.Listening && a.name === 'Spotify' && a.details);
  const song = spotify
    ? { id: spotify.syncId ?? spotify.details, title: spotify.details, artists: spotify.state?.split('; ').filter(Boolean) ?? [] }
    : null;
  return { game, song };
}

/** Handles Events.PresenceUpdate: logs playtime per game, and plays per Spotify song and artist. */
export async function trackPresence(_oldPresence, presence) {
  if (presence.user?.bot) return;
  const userId = presence.userId;
  const now = Date.now();
  const { game, song } = nowPlaying(presence.activities ?? []);
  const songId = song?.id ?? null;
  const was = current.get(userId);
  const wasGame = was?.game ?? null;
  if (wasGame === game && (was?.songId ?? null) === songId) return;

  // Updated before the first await, so the same update arriving from a second server is ignored above.
  const gameChanged = wasGame !== game;
  if (game || songId) {
    current.set(userId, {
      game,
      songId,
      startedAt: gameChanged ? now : (was?.startedAt ?? now),
      countedUntil: gameChanged ? now : (was?.countedUntil ?? now),
    });
  } else {
    current.delete(userId);
  }

  try {
    const profile = await profileFor(userId, presence.user?.username);
    if (!profile) return;
    if (gameChanged) {
      if (wasGame) addPlaytime(profile, wasGame, now - was.countedUntil);
      if (game) gameStats(profile, game).sessions++;
    }
    if (song && songId !== (was?.songId ?? null)) {
      for (const artist of song.artists) bump(profile.artists, artist);
      bump(profile.songs, song.artists.length ? `"${song.title}" by ${song.artists.join(', ')}` : `"${song.title}"`);
    }
    scheduleSave();
  } catch (err) {
    console.error(`[profiles] Could not track ${presence.user?.tag ?? userId}:`, err.message);
  }
}

/** Starts tracking whoever is already playing or listening when the bot comes online. */
export function trackEveryone(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const presence of guild.presences.cache.values()) trackPresence(null, presence);
  }
}

setInterval(async () => {
  if (!current.size) return;
  try {
    const profiles = await store.load();
    const now = Date.now();
    for (const [userId, playing] of current) {
      const profile = profiles[userId];
      if (!playing.game || !profile || profile.optedOut) continue;
      addPlaytime(profile, playing.game, now - playing.countedUntil);
      playing.countedUntil = now;
    }
    scheduleSave();
  } catch (err) {
    console.error('[profiles] Could not checkpoint playtime:', err.message);
  }
}, CHECKPOINT_MS).unref();

/** Notes the hour someone joined voice, to learn when they usually hop on. */
export async function recordJoin(user) {
  try {
    const profile = await profileFor(user.id, user.username);
    if (!profile) return;
    profile.joinHours[new Date().getHours()]++;
    scheduleSave();
  } catch (err) {
    console.error(`[profiles] Could not record ${user.tag} joining:`, err.message);
  }
}

function duration(minutes) {
  return minutes < 90 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes / 60)} hours`;
}

function topEntries(counts, n) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function hourLabel(hour) {
  return `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * The standout things the bot has learned about someone, as sentences about "they" for the AI to roast.
 * `playing` is what they're on right now ({ game, startedAt }), if anything.
 */
export function factsFrom(profile, playing, now = Date.now()) {
  if (!profile || profile.optedOut) return [];
  const facts = [];
  const known = now - profile.since;
  const days = Math.round(known / DAY_MS);
  const over = days < 2 ? 'today' : `in the last ${days} days`;

  if (playing?.game && now - playing.startedAt >= 2 * HOUR_MS) {
    facts.push(`they've been playing ${playing.game} for ${duration((now - playing.startedAt) / 60_000)} straight`);
  }

  const games = Object.entries(profile.games).sort((a, b) => b[1].minutes - a[1].minutes);
  const [topGame, topStats] = games[0] ?? [];
  if (topStats?.minutes >= 60) facts.push(`they've sunk ${duration(topStats.minutes)} into ${topGame} ${over}`);
  // Only once the bot has known them for a week; before that every game looks new.
  const newGame = known >= 7 * DAY_MS && games.find(([, g]) => now - g.firstSeen < 3 * DAY_MS);
  if (newGame) facts.push(`they just started playing ${newGame[0]}, their new obsession`);
  const quitter = games.find(([, g]) => g.sessions >= 3 && g.minutes / g.sessions < 10);
  if (quitter) facts.push(`they keep launching ${quitter[0]} and quitting within minutes`);

  const [[artist, artistPlays] = []] = topEntries(profile.artists, 1);
  if (artistPlays >= 5) facts.push(`they've played ${artist} ${artistPlays} times ${over}`);
  const [[song, songPlays] = []] = topEntries(profile.songs, 1);
  if (songPlays >= 3) facts.push(`they've listened to ${song} ${songPlays} times ${over}`);

  const joins = profile.joinHours.reduce((a, b) => a + b, 0);
  const lateJoins = profile.joinHours.slice(0, 5).reduce((a, b) => a + b, 0);
  if (joins >= 10 && lateJoins / joins >= 0.3) facts.push('they usually hop on voice after midnight');

  return facts;
}

/** What the bot has learned about the user, for greetings and roasts. */
export async function learnedFacts(userId) {
  return factsFrom((await store.load())[userId], current.get(userId));
}

/** Everything the bot has on someone, formatted for /dossier, or null if it has nothing yet. */
export async function dossier(userId) {
  const profile = (await store.load())[userId];
  if (!profile) return null;
  if (profile.optedOut) return "They've opted out, so I'm not tracking them.";

  const lines = [`-# Watching since <t:${Math.floor(profile.since / 1000)}:D>`];
  const games = Object.entries(profile.games)
    .filter(([, g]) => g.minutes >= 1)
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .slice(0, 5);
  if (games.length) lines.push(`🎮 **Games:** ${games.map(([name, g]) => `${name} (${duration(g.minutes)})`).join(' · ')}`);
  const artists = topEntries(profile.artists, 3);
  if (artists.length) lines.push(`🎵 **Artists:** ${artists.map(([name, n]) => `${name} (${n})`).join(' · ')}`);
  const songs = topEntries(profile.songs, 3);
  if (songs.length) lines.push(`🔁 **On repeat:** ${songs.map(([name, n]) => `${name} (${n})`).join(' · ')}`);
  const joins = profile.joinHours.reduce((a, b) => a + b, 0);
  if (joins >= 3) {
    const usual = profile.joinHours.indexOf(Math.max(...profile.joinHours));
    lines.push(`🕒 **Usually hops on:** around ${hourLabel(usual)} (${joins} joins)`);
  }
  const facts = factsFrom(profile, current.get(userId));
  if (facts.length) lines.push(`😈 **Roast material:** ${facts.join('; ')}`);
  if (lines.length === 1) lines.push("Nothing interesting yet. Give it a few days.");
  return lines.join('\n');
}

/** Turns tracking off for someone (deleting what was collected) or back on. */
export async function setTracking(userId, enabled) {
  const profiles = await store.load();
  if (enabled) {
    if (!profiles[userId]?.optedOut) return;
    delete profiles[userId];
  } else {
    profiles[userId] = { optedOut: true };
    current.delete(userId);
  }
  await store.save(profiles);
}
