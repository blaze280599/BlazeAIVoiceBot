import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

// Only needs the Discord settings, so it doesn't import config.js (which also requires the API keys).
const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.DISCORD_CLIENT_ID?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
if (!token || !clientId) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

const rest = new REST().setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

const data = await rest.put(route, { body: commands });
console.log(
  `Registered ${data.length} commands ${guildId ? `to guild ${guildId}` : 'globally (may take up to an hour to appear)'}.`,
);
