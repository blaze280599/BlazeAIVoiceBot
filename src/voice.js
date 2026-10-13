import { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';

const IDLE_DISCONNECT_MS = 15 * 60 * 1000;

// One player and one playback queue per guild so answers don't talk over each other.
const players = new Map();
const queues = new Map();
const idleTimers = new Map();

function getPlayer(guildId) {
  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    player.on('error', (err) => console.error(`[voice] player error in ${guildId}:`, err.message));
    players.set(guildId, player);
  }
  return player;
}

function forgetGuild(guildId) {
  clearTimeout(idleTimers.get(guildId));
  idleTimers.delete(guildId);
  players.get(guildId)?.stop();
  players.delete(guildId);
}

async function connect(channel) {
  const guildId = channel.guild.id;
  let connection = getVoiceConnection(guildId);
  if (!connection || connection.joinConfig.channelId !== channel.id) {
    const isNew = !connection;
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    if (isNew) watchConnection(connection, guildId);
  }
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  return connection;
}

/** Cleans up when the bot is kicked or the connection drops, so the next request rejoins from scratch. */
function watchConnection(connection, guildId) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Moving to another channel or a brief network blip reconnects on its own within a few seconds.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // Kicked or the channel was deleted: give up on this connection.
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => forgetGuild(guildId));
}

function scheduleDisconnect(guildId) {
  clearTimeout(idleTimers.get(guildId));
  idleTimers.set(
    guildId,
    setTimeout(() => {
      getVoiceConnection(guildId)?.destroy();
      forgetGuild(guildId);
    }, IDLE_DISCONNECT_MS),
  );
}

async function play(channel, mp3) {
  const guildId = channel.guild.id;
  clearTimeout(idleTimers.get(guildId));

  try {
    const connection = await connect(channel);
    const player = getPlayer(guildId);
    connection.subscribe(player);

    // createAudioResource transcodes the MP3 through ffmpeg (must be on PATH).
    player.play(createAudioResource(Readable.from(mp3)));
    await entersState(player, AudioPlayerStatus.Playing, 10_000);
    await entersState(player, AudioPlayerStatus.Idle, 10 * 60_000);
  } finally {
    // Even after a failed playback, make sure the bot doesn't sit in the channel forever.
    if (getVoiceConnection(guildId)) scheduleDisconnect(guildId);
  }
}

/** Joins the channel (if needed) and plays the MP3 buffer after anything already queued. */
export function playInChannel(channel, mp3) {
  const guildId = channel.guild.id;
  const previous = queues.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => play(channel, mp3));
  queues.set(guildId, next);
  next.finally(() => {
    if (queues.get(guildId) === next) queues.delete(guildId);
  }).catch(() => {});
  return next;
}

export function leaveChannel(guildId) {
  const connection = getVoiceConnection(guildId);
  // destroy() fires the Destroyed handler, which also cleans up the player and idle timer.
  connection?.destroy();
  forgetGuild(guildId);
  return Boolean(connection);
}
