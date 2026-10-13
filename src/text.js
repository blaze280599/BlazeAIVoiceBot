// Pure text helpers shared by the AI, TTS and Discord code. No config or network, so they're easy to test.

// Matches a bare voice ID or one inside a link like https://fish.audio/app/m/<id>/
const VOICE_ID_RE = /\b([0-9a-f]{32})\b/i;
// A Fish Audio delivery cue like [excited] or [whispering].
const CUE_RE = /\[[^\][\n]{1,40}\]/g;

/** Pulls the voice ID out of a pasted fish.audio link or bare ID, or returns null. */
export function extractVoiceId(input) {
  return input?.match(VOICE_ID_RE)?.[1]?.toLowerCase() ?? null;
}

/** Removes [emotion] cues for showing the text in chat. */
export function stripCues(text) {
  return text.replace(CUE_RE, '').replace(/ {2,}/g, ' ').replace(/ +([,.!?])/g, '$1').replace(/^ +/gm, '').trim();
}

/** Drops *asterisk actions* an AI sometimes adds, which the voice would otherwise read out. */
export function stripAsteriskActions(text) {
  return text.replace(/\*[^*\n]{1,60}\*/g, '').replace(/ {2,}/g, ' ').trim();
}

/** The legacy S1 model uses (parentheses) for cues instead of [brackets]. */
export function toParenCues(text) {
  return text.replace(CUE_RE, (cue) => `(${cue.slice(1, -1)})`);
}

/** Voice titles on Fish Audio often carry junk like "(Noise reduction)" or "[v2]"; strip it to get the character. */
export function characterName(voiceName) {
  const cleaned = voiceName.replace(/[([{].*?[)\]}]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || voiceName.trim();
}

/**
 * Makes a Discord display name sayable: drops emoji, symbols and decoration like "xX_Name_Xx" underscores.
 * Returns null when nothing pronounceable is left, so callers can fall back to the username.
 */
export function speakableName(name) {
  const cleaned = (name ?? '')
    .normalize('NFKC') // Turns fancy-font letters like 𝓑𝓵𝓪𝔃𝓮 into plain ones.
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\p{L}/u.test(cleaned) ? cleaned : null;
}
