import { config } from './config.js';
import { ServiceError } from './errors.js';
import { characterName, stripAsteriskActions } from './text.js';

const BASE_PROMPT = `You are a voice bot in a Discord server. Your answer will be read aloud by a text-to-speech voice.
Answer conversationally in plain sentences: no markdown, bullet points, code blocks, emoji, URLs, or *asterisk actions*.
Keep it short, usually two to four sentences and never more than about 150 words, unless the user explicitly asks for more detail.`;

// Fish Audio S2 reads [bracket] cues as delivery instructions instead of speaking them.
// See https://docs.fish.audio/developer-guide/core-features/emotions
const EMOTION_PROMPT = `Make the delivery expressive with Fish Audio voice cues in square brackets. They are performed, not read aloud.
- Emotion: put it at the very start of a sentence, e.g. "[excited] We won!" or "[sarcastic] Oh, great idea."
  Good emotions: happy, excited, angry, frustrated, sad, sarcastic, proud, confident, surprised, scared, nervous, disgusted, disappointed, curious, confused, smug, determined. Modifiers like [very excited] or [slightly annoyed] are fine.
- Tone, anywhere: [shouting], [whispering], [soft tone], [in a hurry tone], or [emphasis] right before the word to stress.
- Sounds, anywhere: [laughing] Ha ha!, [chuckling], [sighing], [groaning], [gasping], [clear throat], or [break] for a dramatic pause.
Rules: at most one cue per sentence and two to four in the whole answer, so it stays natural. Never stack conflicting emotions, never use parentheses or asterisks for cues, and don't put cues in quotes.
Pick cues that fit the character and the moment, for example [laughing] for a joke or [shouting] for a rant.`;

// Sent with every question. {character} is replaced with the name of the voice the user picked.
const ROLEPLAY_PROMPT = `The voice speaking your answer is called "{character}". You are roleplaying as that character for fun with friends:
answer in first person as them, with their personality, catchphrases, speaking style, and opinions, and stay in character the whole time.
If the name isn't a recognizable person or character, invent a personality that fits the name.
This is an obvious comedy impression, so exaggerate freely, but still actually answer the question.`;

function systemPrompt(voiceName) {
  const parts = [BASE_PROMPT];
  if (config.fishEmotions) parts.push(EMOTION_PROMPT);
  if (voiceName) parts.push(ROLEPLAY_PROMPT.replaceAll('{character}', characterName(voiceName)));
  return parts.join('\n\n');
}

/** Asks the model (via OpenRouter), in character as the chosen voice, and returns the plain-text answer. */
export async function askAI(question, { voiceName } = {}) {
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openRouterApiKey}`,
        'Content-Type': 'application/json',
        // Optional attribution headers OpenRouter shows on its dashboard.
        'X-Title': 'BlazeAIVoiceBot',
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        max_tokens: 1000,
        // Short spoken answers don't need reasoning; turning it off keeps replies fast and cheap.
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: systemPrompt(voiceName) },
          { role: 'user', content: question },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw ServiceError.fromFetchError('OpenRouter', err);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const status = Number(data?.error?.code) || res.status;
    throw new ServiceError('OpenRouter', status, data?.error?.message ?? `HTTP ${res.status}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`OpenRouter returned no text (finish_reason: ${data?.choices?.[0]?.finish_reason})`);
  // The prompt forbids *asterisk actions*, but models still slip them in and the voice would read them out.
  return stripAsteriskActions(text) || text;
}
