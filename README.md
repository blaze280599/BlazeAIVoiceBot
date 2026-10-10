# BlazeAIVoiceBot

A Discord bot that answers questions with DeepSeek V4.1 Flash (via OpenRouter) and speaks the answer in a Fish Audio voice. Fish Audio's community library has thousands of voices, including celebrity impressions.

## Commands

| Command | What it does |
|---|---|
| `/ask question:<text> [voice] [speak]` | The AI answers. If you're in a voice channel, the bot joins it and speaks the answer. Nothing is posted in chat: you get a private "Speaking…" note that disappears when it finishes. Otherwise it posts the text with an MP3 attached. |
| `/say text:<text> [voice] [speak]` | Speaks your text exactly as typed, with no AI involved. |
| `/voices use:<name or link>` | Sets your own voice. `/ask` and `/say` use it from then on, until you change it. |
| `/voices reset:true` | Clears your voice and goes back to the default. |
| `/voices [search] [mine]` | Searches Fish Audio voices and shows their IDs. `mine:true` shows only voices you created. |
| `/leave` | Makes the bot leave the voice channel. It also leaves on its own after 15 minutes of silence. |

`voice` searches Fish Audio's public library as you type, with the most-used voices first. You can also paste a fish.audio voice link (like `https://fish.audio/app/m/<id>/`) or a bare ID. `speak:false` skips the voice channel and posts the MP3 instead.

Which voice gets used: the `voice` option in the command, then your `/voices use:` choice, then `FISH_AUDIO_DEFAULT_VOICE_ID`. Fish Audio's API can't list your liked or bookmarked voices, so copy the link from the voice's page instead. Saved choices are stored in `data/user-voices.json`.

## Emotions

Answers are performed with Fish Audio emotion cues: the AI adds a few tags like `[excited]`, `[sarcastic]`, `[laughing]`, `[whispering]` or `[shouting]`, and the voice acts them out. The tags are removed from any text shown in chat. You can use them yourself in `/say`, e.g. `/say text: [whispering] I have a secret. [laughing] Ha ha!`. Set `FISH_AUDIO_EMOTIONS=false` in `.env` for plain delivery. See [Fish Audio's emotion guide](https://docs.fish.audio/developer-guide/core-features/emotions) for the full list.

## Setup

1. Fill in `.env` (see `.env.example`): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `FISH_AUDIO_API_KEY`, `OPENROUTER_API_KEY`.
2. `npm install`
3. `npm run deploy-commands` (run it again whenever `src/commands.js` changes)
4. `npm start`

Requirements: Node 20+ and `ffmpeg` on your PATH (used for voice channel playback).

When you invite the bot, give it the `bot` and `applications.commands` scopes and the Send Messages, Attach Files, Connect, and Speak permissions.
