import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Each user's chosen voice, set with /voices use:. Kept in a small JSON file so it survives restarts.
const FILE = new URL('../data/user-voices.json', import.meta.url);

let voices = null;

async function load() {
  if (voices) return voices;
  try {
    voices = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    voices = {};
  }
  return voices;
}

async function save() {
  await mkdir(new URL('.', FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(voices, null, 2));
}

/** Returns { id, name } or null. */
export async function getUserVoice(userId) {
  return (await load())[userId] ?? null;
}

export async function setUserVoice(userId, voice) {
  (await load())[userId] = { id: voice.id, name: voice.name };
  await save();
}

export async function clearUserVoice(userId) {
  const all = await load();
  const had = userId in all;
  delete all[userId];
  if (had) await save();
  return had;
}
