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
| `/dossier [user] [tracking]` | Shows what the bot has learned about someone (see [Learning](#learning)). `tracking:false` deletes what it has on you and stops tracking you; `tracking:true` starts again. |
| `/leave` | Makes the bot leave the voice channel. It also leaves on its own after 15 minutes of silence. |

Each user can run `/ask` or `/say` once every 10 seconds, so nobody burns through your API credits. Change it with `COOLDOWN_SECONDS` in `.env` (`0` turns it off).

`voice` searches Fish Audio's public library as you type, with the most-used voices first. You can also paste a fish.audio voice link (like `https://fish.audio/app/m/<id>/`) or a bare ID. `speak:false` skips the voice channel and posts the MP3 instead.

Which voice gets used: the `voice` option in the command, then your `/voices use:` choice, then `FISH_AUDIO_DEFAULT_VOICE_ID`. Fish Audio's API can't list your liked or bookmarked voices, so copy the link from the voice's page instead. Saved choices are stored in `data/user-voices.json`.

## Join greetings

When someone joins a voice channel, the bot greets them out loud by name in Trump's voice, with a short, sarcastic AI-written line that changes every time. It uses their server nickname, then their display name, then their username. Emoji and symbols are removed first, and a nickname with no letters (like `[$(100)$]`) falls back to the username.

Some friends get a greeting tailored to them: `friendBits` in `src/greetings.js` maps a Discord username to what they're into, and the line ribs them about it. Add or edit entries there.

Half the time, if someone's Discord status shows a game, a Spotify song or a stream, the greeting roasts that instead (e.g. what they're listening to). Change the odds with `GREET_ACTIVITY_CHANCE` (a percent, `0` turns it off). This needs **Presence Intent** turned on in the Discord Developer Portal (your app → Bot → Privileged Gateway Intents), otherwise the bot can't log in.

If other people are already in the channel, half the time the greeting plays the newcomer off one of them, using both people's bits ("Ray's here, now the K-pop debate with jig can begin"). Change the odds with `GREET_GROUP_CHANCE` (a percent, `0` turns it off).

The bot goes to whoever joined: it joins their channel, or moves over from another channel once anything it's saying there has finished. Each person is greeted at most once every 10 minutes. Change that with `GREET_COOLDOWN_MINUTES`, change the voice with `GREET_VOICE` (a name, fish.audio link or ID), or turn greetings off with `GREETINGS=false`.

### Leave roasts

When someone disconnects from voice, there's a 50% chance the bot roasts them to whoever's still in the channel ("rage quitting already?"), using the same friend bits and activity as greetings. It only happens if someone's left to hear it, moving to another channel doesn't count (they get greeted there instead), and each person is roasted at most once per `GREET_COOLDOWN_MINUTES`. Change the odds with `LEAVE_ROAST_CHANCE` (a percent, `0` turns it off).

### Voice reactions

When someone in voice deafens, mutes, starts screen sharing or turns their camera on, there's a 50% chance the bot reacts ("deafened? can't handle the truth?"). Screen sharing roasts the game they're playing, if their status shows one. Only switching something on counts, not switching it off, and nothing is said if nobody in the channel can hear it. Each person gets at most one reaction per `GREET_COOLDOWN_MINUTES`, and none in the minute after they're greeted, since people often mute or turn on their camera right after joining. Change the odds with `VOICE_REACT_CHANCE` (a percent, `0` turns it off).

### Running gags

The bot counts how many times each person joins and leaves voice each day. From someone's second join (or second leave) onward, the greeting or roast works the tally in ("that's your fourth rejoin, is your Wi-Fi powered by a hamster?"). Joins and leaves are counted even when the greeting is skipped for the cooldown, but moving between channels doesn't count as a join. The tally resets at midnight (the bot machine's time) and when the bot restarts.

## Learning

The bot watches everyone's Discord status and builds up a profile of each person over time: hours played per game, Spotify plays per song and artist, and what time of day they join voice. It only uses what anyone in the server can already see in their status, never messages or voice audio. Profiles are kept in `data/profiles.json`.

Half the time, a greeting, leave roast or voice reaction picks a couple of standout facts from the profile and works one in. For example:

- they've sunk 42 hours into Arena Breakout Infinite in the last 12 days
- they've been playing it for 5 hours straight
- they just started playing a new game (once the bot has known them for a week)
- they keep launching a game and quitting within minutes
- they've listened to "Espresso" by Sabrina Carpenter 14 times
- they usually hop on voice after midnight

`/dossier` shows the whole profile, so friends can see what the bot has on them. `/dossier tracking:false` deletes your profile and stops tracking you.

Change the odds with `LEARNED_ROAST_CHANCE` (a percent, `0` never brings it up), or turn learning off with `LEARNING=false`. Learning needs Presence Intent (see [Join greetings](#join-greetings)).

## Emotions

Answers are performed with Fish Audio emotion cues: the AI adds a few tags like `[excited]`, `[sarcastic]`, `[laughing]`, `[whispering]` or `[shouting]`, and the voice acts them out. The tags are removed from any text shown in chat. You can use them yourself in `/say`, e.g. `/say text: [whispering] I have a secret. [laughing] Ha ha!`. Set `FISH_AUDIO_EMOTIONS=false` in `.env` for plain delivery. See [Fish Audio's emotion guide](https://docs.fish.audio/developer-guide/core-features/emotions) for the full list.

## Setup

1. Fill in `.env` (see `.env.example`): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `FISH_AUDIO_API_KEY`, `OPENROUTER_API_KEY`.
2. `npm install`
3. `npm run deploy-commands` (run it again whenever `src/commands.js` changes)
4. `npm start`

Requirements: Node 20+ and `ffmpeg` on your PATH (used for voice channel playback).

When you invite the bot, give it the `bot` and `applications.commands` scopes and the Send Messages, Attach Files, Connect, and Speak permissions.
