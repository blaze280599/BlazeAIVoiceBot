import { createJsonStore } from './jsonStore.js';

// Each user's chosen voice, set with /voices use:.
const store = createJsonStore('user-voices.json');

/** Returns { id, name } or null. */
export async function getUserVoice(userId) {
  return (await store.load())[userId] ?? null;
}

export async function setUserVoice(userId, voice) {
  const voices = await store.load();
  voices[userId] = { id: voice.id, name: voice.name };
  await store.save(voices);
}

export async function clearUserVoice(userId) {
  const voices = await store.load();
  const had = userId in voices;
  delete voices[userId];
  if (had) await store.save(voices);
  return had;
}
