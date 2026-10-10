import { config } from './config.js';
import { ServiceError } from './errors.js';

const API = 'https://api.fish.audio';
const CACHE_MS = 5 * 60 * 1000;
// Matches a bare voice ID or one inside a link like https://fish.audio/app/m/<id>/
const MODEL_ID_RE = /\b([0-9a-f]{32})\b/i;

const searchCache = new Map();
const voiceById = new Map();

async function request(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.fishApiKey}`, ...init.headers },
  });
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
  voiceById.set(voice.id, voice);
  return voice;
}

/**
 * Searches the public Fish Audio voice library (community voices, including celebrity impressions).
 * With no query, returns the most-used voices. `mine: true` lists voices you created instead.
 */
export async function searchVoices(query = '', { limit = 25, mine = false } = {}) {
  const key = `${mine}|${limit}|${query.trim().toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.voices;

  const params = new URLSearchParams({ page_size: String(limit), sort_by: 'task_count' });
  if (query.trim()) params.set('title', query.trim());
  if (mine) params.set('self', 'true');

  const res = await request(`/model?${params}`);
  const { items } = await res.json();
  const voices = items.filter((m) => m.type === 'tts' && m.state === 'trained').map(toVoice);
  searchCache.set(key, { voices, at: Date.now() });
  return voices;
}

/** Pulls the voice ID out of a pasted fish.audio link or bare ID, or returns null. */
export function extractVoiceId(input) {
  return input?.match(MODEL_ID_RE)?.[1]?.toLowerCase() ?? null;
}

export async function getVoice(id) {
  if (voiceById.has(id)) return voiceById.get(id);
  try {
    const res = await request(`/model/${encodeURIComponent(id)}`);
    return toVoice(await res.json());
  } catch {
    return null;
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

const CUE_RE = /\[[^\][\n]{1,40}\]/g;

/** Removes [emotion] cues for showing the text in chat. */
export function stripCues(text) {
  return text.replace(CUE_RE, '').replace(/ {2,}/g, ' ').replace(/ +([,.!?])/g, '$1').replace(/^ +/gm, '').trim();
}

/** Tidies text for TTS: drops *asterisk actions* the voice would read out, and adapts cue syntax to the model. */
function prepareForSpeech(text) {
  let out = text.replace(/\*[^*\n]{1,60}\*/g, '').replace(/ {2,}/g, ' ').trim();
  // The legacy S1 model uses (parentheses) instead of [brackets].
  if (config.fishModel === 's1') out = out.replace(CUE_RE, (cue) => `(${cue.slice(1, -1)})`);
  return out;
}

/** Returns MP3 audio as a Buffer. */
export async function textToSpeech(text, voiceId) {
  const res = await request('/v1/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', model: config.fishModel },
    body: JSON.stringify({ text: prepareForSpeech(text), reference_id: voiceId, format: 'mp3', mp3_bitrate: 128 }),
  });
  return Buffer.from(await res.arrayBuffer());
}
