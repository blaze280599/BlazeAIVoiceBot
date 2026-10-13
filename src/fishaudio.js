import { config } from './config.js';
import { ServiceError } from './errors.js';
import { extractVoiceId, toParenCues } from './text.js';

const API = 'https://api.fish.audio';
const SEARCH_CACHE_MS = 5 * 60 * 1000;
const VOICE_CACHE_MS = 60 * 60 * 1000;
// Every autocomplete keystroke is a new search, so cap the caches to keep memory flat on busy servers.
const MAX_CACHE_ENTRIES = 500;

const searchCache = new Map();
const voiceCache = new Map();

function cacheGet(cache, key, maxAgeMs) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at >= maxAgeMs) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(cache, key, value) {
  // Re-inserting moves the key to the end, so the first key is always the oldest.
  cache.delete(key);
  cache.set(key, { value, at: Date.now() });
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

async function request(path, { timeoutMs = 15_000, ...init } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.fishApiKey}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw ServiceError.fromFetchError('Fish Audio', err);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body).message ?? detail;
    } catch {}
    throw new ServiceError('Fish Audio', res.status, `${detail} (${path.split('?')[0]})`);
  }
  return res;
}

function toVoice(model) {
  const voice = {
    id: model._id,
    name: model.title,
    author: model.author?.nickname ?? null,
    uses: model.task_count ?? 0,
  };
  cacheSet(voiceCache, voice.id, voice);
  return voice;
}

/**
 * Searches the public Fish Audio voice library (community voices, including celebrity impressions).
 * With no query, returns the most-used voices. `mine: true` lists voices you created instead.
 */
export async function searchVoices(query = '', { limit = 25, mine = false } = {}) {
  const key = `${mine}|${limit}|${query.trim().toLowerCase()}`;
  const cached = cacheGet(searchCache, key, SEARCH_CACHE_MS);
  if (cached) return cached;

  const params = new URLSearchParams({ page_size: String(limit), sort_by: 'task_count' });
  if (query.trim()) params.set('title', query.trim());
  if (mine) params.set('self', 'true');

  const res = await request(`/model?${params}`);
  const { items } = await res.json();
  const voices = items.filter((m) => m.type === 'tts' && m.state === 'trained').map(toVoice);
  cacheSet(searchCache, key, voices);
  return voices;
}

/** Returns the voice, or null if no voice has that ID. Other failures (credits, API key, outages) are thrown. */
export async function getVoice(id) {
  const cached = cacheGet(voiceCache, id, VOICE_CACHE_MS);
  if (cached) return cached;
  try {
    const res = await request(`/model/${encodeURIComponent(id)}`);
    return toVoice(await res.json());
  } catch (err) {
    if (err instanceof ServiceError && [400, 404, 422].includes(err.status)) return null;
    throw err;
  }
}

/**
 * Accepts a voice ID or fish.audio link (what autocomplete sends, or one pasted in)
 * or a typed name, which picks the most-used matching voice. `fallbackId` is used when input is empty.
 */
export async function resolveVoice(input, { fallbackId } = {}) {
  const value = input?.trim() || fallbackId || config.defaultVoiceId;
  if (!value) {
    const [top] = await searchVoices('', { limit: 1 });
    if (!top) throw new Error('Could not load any voices from Fish Audio.');
    return top;
  }
  const id = extractVoiceId(value);
  if (id) return getVoice(id);
  const [best] = await searchVoices(value, { limit: 1 });
  return best ?? null;
}

/** Returns MP3 audio as a Buffer. */
export async function textToSpeech(text, voiceId) {
  const speech = config.fishModel === 's1' ? toParenCues(text) : text;
  const res = await request('/v1/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', model: config.fishModel },
    body: JSON.stringify({ text: speech, reference_id: voiceId, format: 'mp3', mp3_bitrate: 128 }),
    timeoutMs: 60_000,
  });
  return Buffer.from(await res.arrayBuffer());
}
