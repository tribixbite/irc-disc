#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import * as helpers from './helpers';

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

  const config = completePath.endsWith('.json')
    ? readJSONConfig(completePath)
    : await readJSConfig(completePath);
  if (!config || typeof config !== 'object') {
    console.error(
      'expecting an object exported from the config file, got',
      config,
    );
    process.exit(2);
  }
  await helpers.createBot(config as Record<string, unknown>);
}

// Execute if run directly (when used as CLI entry point)
if (require.main === module) {
  void run();
}
