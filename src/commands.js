import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a question and get a spoken answer')
    .addStringOption((o) =>
      o.setName('question').setDescription('What do you want to ask?').setRequired(true).setMaxLength(1500),
    )
    .addStringOption((o) =>
      o
        .setName('voice')
        .setDescription('Search e.g. "trump", or paste a fish.audio voice link/ID')
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o
        .setName('speak')
        .setDescription('Play the answer in your voice channel (default: yes, if you are in one)'),
    ),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Have the bot say exactly what you type, in a chosen voice')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to speak').setRequired(true).setMaxLength(1500),
    )
    .addStringOption((o) =>
      o.setName('voice').setDescription('Search e.g. "trump", or paste a fish.audio voice link/ID').setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o.setName('speak').setDescription('Play it in your voice channel (default: yes, if you are in one)'),
    ),

  new SlashCommandBuilder()
    .setName('voices')
    .setDescription('Search Fish Audio voices, or pick the voice the bot uses for you')
    .addStringOption((o) =>
      o
        .setName('use')
        .setDescription('Set your voice: search by name or paste a fish.audio voice link/ID')
        .setAutocomplete(true),
    )
    .addBooleanOption((o) => o.setName('reset').setDescription('Go back to the server default voice'))
    .addStringOption((o) => o.setName('search').setDescription('Name to search for, e.g. "trump" (blank = most popular)'))
    .addBooleanOption((o) => o.setName('mine').setDescription('Only show voices you created on Fish Audio')),

  new SlashCommandBuilder().setName('leave').setDescription('Make the bot leave the voice channel'),
].map((c) => c.toJSON());
