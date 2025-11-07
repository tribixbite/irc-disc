#!/usr/bin/env node
/**
 * Standalone Discord bot test - verifies MESSAGE_CONTENT intent is working
 * This will log every message event received to confirm gateway connectivity
 */

const discord = require('discord.js');
const fs = require('fs');
const path = require('path');
const stripJsonComments = require('strip-json-comments');

// Read config from the dirc directory
const configPath = process.argv[2] || '../dirc/config.json';
const configFile = fs.readFileSync(configPath, 'utf8');
let config = JSON.parse(stripJsonComments(configFile));

// Handle array of configs (multi-bot setup) - use first bot
if (Array.isArray(config)) {
  if (config.length === 0) {
    console.error('Config array is empty');
    process.exit(1);
  }
  console.log(`Found ${config.length} bot config(s), using first one`);
  config = config[0];
}

console.log('🔧 Creating Discord client with intents...');
const client = new discord.Client({
  intents: [
    discord.Intents.FLAGS.GUILDS,
    discord.Intents.FLAGS.GUILD_MESSAGES,
    discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    discord.Intents.FLAGS.GUILD_MEMBERS,
    discord.Intents.FLAGS.MESSAGE_CONTENT
  ],
  partials: ['MESSAGE']
});

client.on('ready', () => {
  console.log('✅ Discord client ready!');
  console.log(`📝 Logged in as: ${client.user.tag}`);
  console.log(`🔢 Guild count: ${client.guilds.cache.size}`);

  client.guilds.cache.forEach(guild => {
    console.log(`  - Guild: ${guild.name} (${guild.id})`);
    console.log(`    Members cached: ${guild.members.cache.size}`);
    console.log(`    Channels: ${guild.channels.cache.size}`);
  });

  console.log('\n⏳ Waiting for messages... (send a message in Discord now)');
  console.log('Press Ctrl+C to exit\n');
});

client.on('messageCreate', (message) => {
  console.log('🎉 MESSAGE RECEIVED!');
  console.log(`  Channel: ${message.channel.name} (${message.channel.id})`);
  console.log(`  Author: ${message.author.tag} (${message.author.id})`);
  console.log(`  Content: "${message.content}"`);
  console.log(`  Type: ${message.channel.type}`);
  console.log(`  Is bot: ${message.author.bot}`);
  console.log('---');
});

client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

client.on('warn', (warning) => {
  console.warn('⚠️ Discord client warning:', warning);
});

console.log('🚀 Logging in to Discord...');
client.login(config.discordToken || process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('✅ Login successful');
  })
  .catch((error) => {
    console.error('❌ Login failed:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  client.destroy();
  process.exit(0);
});
