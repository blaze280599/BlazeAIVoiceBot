import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

/**
 * A small JSON file in data/ that survives restarts. load() reads it once and returns the same object every time;
 * change that object, then save() it.
 */
export function createJsonStore(fileName) {
  const file = new URL(`../data/${fileName}`, import.meta.url);
  const tempFile = new URL(`../data/${fileName}.tmp`, import.meta.url);

  let loading = null;
  // Saves run one at a time so two writes never interleave.
  let saving = Promise.resolve();

  async function read() {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      // No file yet just means nothing has been saved. Anything else (e.g. permissions) is a real error.
      if (err.code === 'ENOENT') return {};
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      // Keep the broken file instead of overwriting it on the next save, then start fresh.
      const backup = new URL(`../data/${fileName.replace(/\.json$/, '')}.corrupt-${Date.now()}.json`, import.meta.url);
      await rename(file, backup);
      console.error(`[jsonStore] ${file.pathname} was not valid JSON; moved it to ${backup.pathname} and started fresh.`);
      return {};
    }
  }

  function load() {
    loading ??= read();
    // Let a failed load be retried on the next call instead of caching the error.
    loading.catch(() => {
      loading = null;
    });
    return loading;
  }

  function save(data) {
    saving = saving
      .catch(() => {})
      .then(async () => {
        await mkdir(new URL('.', file), { recursive: true });
        // Write to a temp file and rename it over the real one, so a crash mid-write can't leave half a file.
        await writeFile(tempFile, JSON.stringify(data, null, 2));
        await rename(tempFile, file);
      });
    return saving;
  }

  return { load, save };
}
