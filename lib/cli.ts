#!/usr/bin/env node

import fs from 'node:fs';
import { resolve, join } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import * as helpers from './helpers';
import { logger } from './logger';
import { validateConfig } from './config/schema';
import { ZodError } from 'zod';

// Load package.json for version info
const packageJson: { version: string } = JSON.parse(
  fs.readFileSync(join(__dirname, '../package.json'), 'utf8')
);

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

/**
 * Apply environment variable overrides for sensitive configuration
 * Prevents storing secrets in config files (security best practice)
 *
 * Supported environment variables:
 * - DISCORD_TOKEN: Discord bot token
 * - IRC_PASSWORD: IRC server password
 * - IRC_SASL_USERNAME: SASL authentication username
 * - IRC_SASL_PASSWORD: SASL authentication password
 * - S3_ENDPOINT: S3 endpoint URL
 * - S3_BUCKET: S3 bucket name
 * - S3_ACCESS_KEY_ID: S3 access key
 * - S3_SECRET_ACCESS_KEY: S3 secret key
 * - S3_REGION: S3 region
 */
function applyEnvironmentOverrides(config: unknown): unknown {
  const overridden = { ...(config as Record<string, unknown>) };

  // Discord token
  if (process.env.DISCORD_TOKEN) {
    overridden.discordToken = process.env.DISCORD_TOKEN;
    logger.info('Using Discord token from DISCORD_TOKEN environment variable');
  }

  // IRC password
  if (process.env.IRC_PASSWORD) {
    overridden.password = process.env.IRC_PASSWORD;
    logger.info('Using IRC password from IRC_PASSWORD environment variable');
  }

  // SASL authentication
  if (process.env.IRC_SASL_USERNAME || process.env.IRC_SASL_PASSWORD) {
    overridden.sasl = (overridden.sasl as Record<string, unknown> | undefined) || {};
    const sasl = overridden.sasl as Record<string, unknown>;
    if (process.env.IRC_SASL_USERNAME) {
      sasl.username = process.env.IRC_SASL_USERNAME;
      logger.info('Using SASL username from IRC_SASL_USERNAME environment variable');
    }
    if (process.env.IRC_SASL_PASSWORD) {
      sasl.password = process.env.IRC_SASL_PASSWORD;
      logger.info('Using SASL password from IRC_SASL_PASSWORD environment variable');
    }
  }

  // S3 configuration
  if (process.env.S3_ENDPOINT || process.env.S3_BUCKET ||
      process.env.S3_ACCESS_KEY_ID || process.env.S3_SECRET_ACCESS_KEY ||
      process.env.S3_REGION) {
    overridden.s3 = (overridden.s3 as Record<string, unknown> | undefined) || {};
    const s3 = overridden.s3 as Record<string, unknown>;

    if (process.env.S3_ENDPOINT) {
      s3.endpoint = process.env.S3_ENDPOINT;
      logger.info('Using S3 endpoint from S3_ENDPOINT environment variable');
    }
    if (process.env.S3_BUCKET) {
      s3.bucket = process.env.S3_BUCKET;
      logger.info('Using S3 bucket from S3_BUCKET environment variable');
    }
    if (process.env.S3_ACCESS_KEY_ID) {
      s3.accessKeyId = process.env.S3_ACCESS_KEY_ID;
      logger.info('Using S3 access key from S3_ACCESS_KEY_ID environment variable');
    }
    if (process.env.S3_SECRET_ACCESS_KEY) {
      s3.secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
      logger.info('Using S3 secret key from S3_SECRET_ACCESS_KEY environment variable');
    }
    if (process.env.S3_REGION) {
      s3.region = process.env.S3_REGION;
      logger.info('Using S3 region from S3_REGION environment variable');
    }
  }

  return overridden;
}

export async function run(): Promise<void> {
  // Print version and logging info
  logger.info(`irc-disc v${packageJson.version}`);
  logger.info(`Log level: ${logger.level} (set NODE_ENV=development for debug logs)`);

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

  // Apply environment variable overrides for sensitive credentials
  // This prevents storing secrets in config files
  config = applyEnvironmentOverrides(config);

  // Validate configuration with Zod schema
  // This prevents runtime crashes from invalid config
  try {
    const validatedConfig = validateConfig(config);
    logger.info('Configuration validated successfully');
    const bot = await helpers.createBot(validatedConfig as Record<string, unknown>);

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`\n${signal} received - initiating graceful shutdown...`);
      try {
        await bot.disconnect();
        logger.info('✅ Bot disconnected gracefully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });

  } catch (error) {
    if (error instanceof ZodError) {
      console.error('\n❌ Configuration validation failed:\n');
      error.issues.forEach((err) => {
        console.error(`  • ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\nPlease fix your configuration and try again.');
      console.error('See https://github.com/tribixbite/irc-disc#configuration for details.\n');
    } else {
      console.error('Unexpected error during config validation:', error);
    }
    process.exit(2);
  }
}

// Execute if run directly (when used as CLI entry point)
if (require.main === module) {
  void run();
}
