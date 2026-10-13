import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

// Each user's chosen voice, set with /voices use:. Kept in a small JSON file so it survives restarts.
const FILE = new URL('../data/user-voices.json', import.meta.url);
const TEMP_FILE = new URL('../data/user-voices.json.tmp', import.meta.url);

let loading = null;
// Saves run one at a time so two writes never interleave.
let saving = Promise.resolve();

async function readVoices() {
  let text;
  try {
    text = await readFile(FILE, 'utf8');
  } catch (err) {
    // No file yet just means nobody has picked a voice. Anything else (e.g. permissions) is a real error.
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    // Keep the broken file instead of overwriting it on the next save, then start fresh.
    const backup = new URL(`../data/user-voices.corrupt-${Date.now()}.json`, import.meta.url);
    await rename(FILE, backup);
    console.error(`[userVoices] ${FILE.pathname} was not valid JSON; moved it to ${backup.pathname} and started fresh.`);
    return {};
  }
}

function load() {
  loading ??= readVoices();
  // Let a failed load be retried on the next call instead of caching the error.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

function save(voices) {
  saving = saving
    .catch(() => {})
    .then(async () => {
      await mkdir(new URL('.', FILE), { recursive: true });
      // Write to a temp file and rename it over the real one, so a crash mid-write can't leave half a file.
      await writeFile(TEMP_FILE, JSON.stringify(voices, null, 2));
      await rename(TEMP_FILE, FILE);
    });
  return saving;
}

/** Returns { id, name } or null. */
export async function getUserVoice(userId) {
  return (await load())[userId] ?? null;
}

export async function setUserVoice(userId, voice) {
  const voices = await load();
  voices[userId] = { id: voice.id, name: voice.name };
  await save(voices);
}

export async function clearUserVoice(userId) {
  const voices = await load();
  const had = userId in voices;
  delete voices[userId];
  if (had) await save(voices);
  return had;
}
