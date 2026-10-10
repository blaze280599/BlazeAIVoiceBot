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

async function connect(channel) {
  let connection = getVoiceConnection(channel.guild.id);
  if (!connection || connection.joinConfig.channelId !== channel.id) {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
  }
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  return connection;
}

function scheduleDisconnect(guildId) {
  clearTimeout(idleTimers.get(guildId));
  idleTimers.set(
    guildId,
    setTimeout(() => {
      getVoiceConnection(guildId)?.destroy();
      players.delete(guildId);
      idleTimers.delete(guildId);
    }, IDLE_DISCONNECT_MS),
  );
}

async function play(channel, mp3) {
  const guildId = channel.guild.id;
  clearTimeout(idleTimers.get(guildId));

  const connection = await connect(channel);
  const player = getPlayer(guildId);
  connection.subscribe(player);

  // createAudioResource transcodes the MP3 through ffmpeg (must be on PATH).
  player.play(createAudioResource(Readable.from(mp3)));
  await entersState(player, AudioPlayerStatus.Playing, 10_000);
  await entersState(player, AudioPlayerStatus.Idle, 10 * 60_000);

  scheduleDisconnect(guildId);
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
  clearTimeout(idleTimers.get(guildId));
  idleTimers.delete(guildId);
  players.get(guildId)?.stop();
  players.delete(guildId);
  const connection = getVoiceConnection(guildId);
  connection?.destroy();
  return Boolean(connection);
}
