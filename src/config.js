import 'dotenv/config';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name} (see .env.example)`);
    process.exit(1);
  }
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordGuildId: process.env.DISCORD_GUILD_ID?.trim() || null,

  fishApiKey: required('FISH_AUDIO_API_KEY'),
  fishModel: process.env.FISH_AUDIO_MODEL?.trim() || 's2.1-pro',
  // Let the AI add [laughing], [excited], [whispering]... cues to its answers. Set to false for plain delivery.
  fishEmotions: process.env.FISH_AUDIO_EMOTIONS?.trim().toLowerCase() !== 'false',
  // Used when /ask is run without picking a voice. Falls back to the most-used public voice.
  defaultVoiceId: process.env.FISH_AUDIO_DEFAULT_VOICE_ID?.trim() || null,

  openRouterApiKey: required('OPENROUTER_API_KEY'),
  openRouterModel: process.env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash',

  // How long each user waits between /ask or /say commands. 0 turns the cooldown off.
  cooldownSeconds: Math.max(0, Number(process.env.COOLDOWN_SECONDS?.trim() || 10) || 0),
};
