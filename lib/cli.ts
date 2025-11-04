#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import * as helpers from './helpers';
import { logger } from './logger';

// Global error handlers for production stability
process.on('uncaughtException', (error: Error, origin: string) => {
  logger.error(`[FATAL] Uncaught Exception at: ${origin}`, error);
  logger.error('Stack trace:', error.stack);
  // Exit cleanly - let process manager restart the bot
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('[FATAL] Unhandled Promise Rejection at:', promise);
  logger.error('Reason:', reason);
  // Exit cleanly - let process manager restart the bot
  process.exit(1);
});

function readJSONConfig(filePath: string): unknown {
  const configFile = fs.readFileSync(filePath, { encoding: 'utf8' });
  return JSON.parse(stripJsonComments(configFile));
}

async function readJSConfig(filePath: string): Promise<unknown> {
  const { default: config } = await import(filePath);
  return config;
}

export async function run(): Promise<void> {
  const args = process.argv.slice(2);
  let configPath = 'config.json'; // Default to config.json in cwd

  // Parse arguments
  if (args.length > 0) {
    if (args[0] === '-c' || args[0] === '--config') {
      if (!args[1]) {
        console.error('Usage: irc-disc [-c|--config <config-file>]');
        console.error('Defaults to config.json in current directory');
        return process.exit(2);
      }
      configPath = args[1];
    } else if (args[0] === '-h' || args[0] === '--help') {
      console.log('Usage: irc-disc [-c|--config <config-file>]');
      console.log('');
      console.log('Options:');
      console.log('  -c, --config <file>  Path to config file (default: config.json)');
      console.log('  -h, --help           Show this help message');
      console.log('');
      console.log('Examples:');
      console.log('  irc-disc                      # Uses config.json from current directory');
      console.log('  irc-disc -c myconfig.json     # Uses specified config file');
      console.log('  irc-disc --config bot.js      # Uses JavaScript config file');
      return process.exit(0);
    } else {
      // Assume it's a config file path
      configPath = args[0];
    }
  }

  const completePath = resolve(process.cwd(), configPath);

  // Check if config file exists
  if (!fs.existsSync(completePath)) {
    console.error(`Error: Config file not found: ${completePath}`);
    console.error('');
    console.error('Usage: irc-disc [-c|--config <config-file>]');
    console.error('Defaults to config.json in current directory');
    return process.exit(2);
  }

  let config = completePath.endsWith('.json')
    ? readJSONConfig(completePath)
    : await readJSConfig(completePath);

  if (!config || typeof config !== 'object') {
    console.error(
      'expecting an object exported from the config file, got',
      config,
    );
    process.exit(2);
  }

  // Handle array of configs (multi-bot setup) - use first bot
  if (Array.isArray(config)) {
    if (config.length === 0) {
      console.error('Config array is empty');
      process.exit(2);
    }
    console.log(`Found ${config.length} bot config(s), using first one`);
    config = config[0];
  }

  await helpers.createBot(config as Record<string, unknown>);
}

// Execute if run directly (when used as CLI entry point)
if (require.main === module) {
  void run();
}
