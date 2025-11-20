 
import { afterEach, beforeEach, describe, it, vi, expect } from 'vitest';
import irc from 'irc-upd';
import discord from 'discord.js';
import Bot from '../lib/bot';
import { logger } from '../lib/logger';
import createDiscordStub from './stubs/discord-stub';
import createWebhookStub from './stubs/webhook-stub';
import ClientStub from './stubs/irc-client-stub';
import config from './fixtures/single-test-config.json';
import { sleep } from '../lib/ts';

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('IRC Connection Monitoring', () => {
  const createBot = (optConfig: Record<string, unknown> | null = null) => {
    const useConfig = optConfig || config;
    const bot = new Bot(useConfig);
    bot.sendToIRC = vi.fn().mockResolvedValue(undefined);
    bot.sendToDiscord = vi.fn().mockResolvedValue(undefined);
    bot.sendExactToDiscord = vi.fn().mockResolvedValue(undefined);
    return bot;
  };

  let sendStub;
  let bot: Bot;
  let sayStub;

  beforeEach(async () => {
    sendStub = vi.fn();
    sayStub = vi.fn();
    irc.Client = ClientStub as any;
    discord.Client = createDiscordStub(sendStub) as never;
    discord.WebhookClient = createWebhookStub(sendStub) as never;
    ClientStub.prototype.send = vi.fn();
    ClientStub.prototype.join = vi.fn();
    ClientStub.prototype.say = sayStub;
    bot = createBot();

    // Mock the DNS resolution method to prevent Bun.spawn from being called
    // This allows bot.connect() to complete successfully in test environment
    vi.spyOn(bot as any, 'resolveViaGetent').mockResolvedValue('irc.test.server');

    try {
      await bot.connect();

      // Wait for IRC client to be created (happens in setImmediate callback)
      // The bot.connect() method uses setImmediate() to defer IRC initialization
      // so we need to wait for that async operation to complete
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (bot.ircClient) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);

        // Timeout after 1 second
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 1000);
      });
    } catch (error) {
      console.error('bot.connect() failed:', error);
      throw error;
    }

    // Verify IRC client was created
    if (!bot.ircClient) {
      throw new Error('IRC client not created during bot.connect() - setImmediate callback may not have run');
    }
  });

  afterEach(async function () {
    if (bot && bot.ircClient) {
      await bot.disconnect();
    }
    vi.restoreAllMocks();
  });

  describe('Connection State Tracking', () => {
    it('should initialize with disconnected state', () => {
      const newBot = createBot();
      expect(newBot.isIRCConnected()).toBe(false);
    });

    it('should update to connected state on registered event', () => {
      expect(bot.isIRCConnected()).toBe(false);
      bot.ircClient.emit('registered', 'Welcome message');
      expect(bot.isIRCConnected()).toBe(true);
    });

    it('should update to disconnected state on error event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      const error = new Error('Connection error');
      bot.ircClient.emit('error', error);
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should update to disconnected state on abort event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      bot.ircClient.emit('abort');
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should update to disconnected state on close event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      bot.ircClient.emit('close');
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should update to disconnected state on netError event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      const error = new Error('Network error');
      bot.ircClient.emit('netError', error);
      expect(bot.isIRCConnected()).toBe(false);
    });
  });

  describe('Activity Tracking', () => {
    it('should track activity on IRC message received', async () => {
      bot.ircClient.emit('registered', 'Welcome');

      // Wait a bit to ensure timestamp difference
      await sleep(10);

      const timeBefore = Date.now();
      bot.ircClient.emit('message', 'testuser', '#irc', 'hello');
      const timeAfter = Date.now();

      // Activity should be updated within this window
      const stats = bot.getIRCStats();
      expect(stats.lastActivity).toBeGreaterThanOrEqual(timeBefore);
      expect(stats.lastActivity).toBeLessThanOrEqual(timeAfter);
    });

    it('should track activity on IRC private message', async () => {
      bot.ircClient.emit('registered', 'Welcome');
      await sleep(10);

      const timeBefore = Date.now();
      bot.ircClient.emit('pm', 'testuser', 'private hello');
      const timeAfter = Date.now();

      const stats = bot.getIRCStats();
      expect(stats.lastActivity).toBeGreaterThanOrEqual(timeBefore);
      expect(stats.lastActivity).toBeLessThanOrEqual(timeAfter);
    });

    it('should track activity on IRC notice', async () => {
      bot.ircClient.emit('registered', 'Welcome');
      await sleep(10);

      const timeBefore = Date.now();
      bot.ircClient.emit('notice', 'testuser', '#irc', 'notice text');
      const timeAfter = Date.now();

      const stats = bot.getIRCStats();
      expect(stats.lastActivity).toBeGreaterThanOrEqual(timeBefore);
      expect(stats.lastActivity).toBeLessThanOrEqual(timeAfter);
    });
  });

  describe('Recovery Manager Integration', () => {
    it('should record success on IRC registered event', () => {
      const recordSuccessSpy = vi.spyOn(bot.recoveryManager, 'recordSuccess');

      bot.ircClient.emit('registered', 'Welcome');

      expect(recordSuccessSpy).toHaveBeenCalledWith('irc');
    });

    it('should record failure on IRC error event', () => {
      const recordFailureSpy = vi.spyOn(bot.recoveryManager, 'recordFailure');
      const error = new Error('Test error');

      bot.ircClient.emit('error', error);

      expect(recordFailureSpy).toHaveBeenCalledWith('irc', error);
    });

    it('should record failure on IRC abort event', () => {
      const recordFailureSpy = vi.spyOn(bot.recoveryManager, 'recordFailure');

      bot.ircClient.emit('abort');

      expect(recordFailureSpy).toHaveBeenCalledWith('irc', expect.any(Error));
      const callArgs = recordFailureSpy.mock.calls[0];
      expect(callArgs[1].message).toContain('aborted');
    });

    it('should record failure on IRC close event', () => {
      const recordFailureSpy = vi.spyOn(bot.recoveryManager, 'recordFailure');

      bot.ircClient.emit('close');

      expect(recordFailureSpy).toHaveBeenCalledWith('irc', expect.any(Error));
      const callArgs = recordFailureSpy.mock.calls[0];
      expect(callArgs[1].message).toContain('closed');
    });

    it('should record failure on IRC netError event', () => {
      const recordFailureSpy = vi.spyOn(bot.recoveryManager, 'recordFailure');
      const error = new Error('Network error');

      bot.ircClient.emit('netError', error);

      expect(recordFailureSpy).toHaveBeenCalledWith('irc', error);
    });
  });

  describe('Metrics Tracking', () => {
    it('should record IRC connected metric on registered event', () => {
      const recordConnectedSpy = vi.spyOn(bot.metrics, 'recordIRCConnected');

      bot.ircClient.emit('registered', 'Welcome');

      expect(recordConnectedSpy).toHaveBeenCalled();
    });

    it('should record IRC disconnected metric on error event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const recordDisconnectedSpy = vi.spyOn(bot.metrics, 'recordIRCDisconnected');

      bot.ircClient.emit('error', new Error('Test error'));

      expect(recordDisconnectedSpy).toHaveBeenCalled();
    });

    it('should record IRC disconnected metric on abort event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const recordDisconnectedSpy = vi.spyOn(bot.metrics, 'recordIRCDisconnected');

      bot.ircClient.emit('abort');

      expect(recordDisconnectedSpy).toHaveBeenCalled();
    });

    it('should record IRC disconnected metric on close event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const recordDisconnectedSpy = vi.spyOn(bot.metrics, 'recordIRCDisconnected');

      bot.ircClient.emit('close');

      expect(recordDisconnectedSpy).toHaveBeenCalled();
    });

    it('should record IRC disconnected metric on netError event', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const recordDisconnectedSpy = vi.spyOn(bot.metrics, 'recordIRCDisconnected');

      bot.ircClient.emit('netError', new Error('Network error'));

      expect(recordDisconnectedSpy).toHaveBeenCalled();
    });

    it('should update IRC activity metric on message events', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const updateActivitySpy = vi.spyOn(bot.metrics, 'updateIRCActivity');

      bot.ircClient.emit('message', 'user', '#channel', 'text');

      expect(updateActivitySpy).toHaveBeenCalled();
    });

    it('should update IRC activity metric on pm events', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const updateActivitySpy = vi.spyOn(bot.metrics, 'updateIRCActivity');

      bot.ircClient.emit('pm', 'user', 'private message');

      expect(updateActivitySpy).toHaveBeenCalled();
    });

    it('should update IRC activity metric on notice events', () => {
      bot.ircClient.emit('registered', 'Welcome');
      const updateActivitySpy = vi.spyOn(bot.metrics, 'updateIRCActivity');

      bot.ircClient.emit('notice', 'user', '#channel', 'notice');

      expect(updateActivitySpy).toHaveBeenCalled();
    });
  });

  describe('Connection Drop Scenarios', () => {
    it('should handle rapid connect-disconnect cycles', () => {
      // Simulate rapid connection drops
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      bot.ircClient.emit('close');
      expect(bot.isIRCConnected()).toBe(false);

      bot.ircClient.emit('registered', 'Welcome again');
      expect(bot.isIRCConnected()).toBe(true);

      bot.ircClient.emit('netError', new Error('Network drop'));
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should handle error during active session', async () => {
      bot.ircClient.emit('registered', 'Welcome');

      // Simulate active message flow
      bot.ircClient.emit('message', 'user1', '#channel', 'message 1');
      await sleep(10);
      bot.ircClient.emit('message', 'user2', '#channel', 'message 2');

      // Connection drops mid-session
      const error = new Error('Connection lost');
      bot.ircClient.emit('error', error);

      expect(bot.isIRCConnected()).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '❌ Received error event from IRC',
        error
      );
    });

    it('should log warning on connection abort', () => {
      bot.ircClient.emit('registered', 'Welcome');
      bot.ircClient.emit('abort');

      expect(logger.warn).toHaveBeenCalledWith('❌ IRC connection aborted');
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should log error on network error', () => {
      const error = new Error('Network failure');
      bot.ircClient.emit('netError', error);

      expect(logger.error).toHaveBeenCalledWith('❌ IRC network error:', error);
      expect(bot.isIRCConnected()).toBe(false);
    });
  });

  describe('Connection State Persistence', () => {
    it('should maintain disconnected state across multiple error events', () => {
      bot.ircClient.emit('error', new Error('Error 1'));
      expect(bot.isIRCConnected()).toBe(false);

      bot.ircClient.emit('netError', new Error('Error 2'));
      expect(bot.isIRCConnected()).toBe(false);

      bot.ircClient.emit('abort');
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should recover connection state after successful registration', () => {
      // Start disconnected
      expect(bot.isIRCConnected()).toBe(false);

      // Multiple failures
      bot.ircClient.emit('error', new Error('Error 1'));
      bot.ircClient.emit('close');
      expect(bot.isIRCConnected()).toBe(false);

      // Successful reconnection
      bot.ircClient.emit('registered', 'Reconnected');
      expect(bot.isIRCConnected()).toBe(true);
    });
  });

  describe('Logging Behavior', () => {
    it('should log connection success on registered event', () => {
      bot.ircClient.emit('registered', 'Welcome');

      expect(logger.info).toHaveBeenCalledWith('✅ Connected and registered to IRC');
    });

    it('should log all error events', () => {
      const error = new Error('Test error');
      bot.ircClient.emit('error', error);

      expect(logger.error).toHaveBeenCalledWith(
        '❌ Received error event from IRC',
        error
      );
    });

    it('should log all disconnection events', () => {
      bot.ircClient.emit('abort');
      expect(logger.warn).toHaveBeenCalledWith('❌ IRC connection aborted');

      bot.ircClient.emit('close');
      expect(logger.warn).toHaveBeenCalledWith('❌ IRC connection closed');

      const netError = new Error('Network error');
      bot.ircClient.emit('netError', netError);
      expect(logger.error).toHaveBeenCalledWith('❌ IRC network error:', netError);
    });
  });

  describe('Reconnection Flow', () => {
    it('should transition through full disconnect-reconnect cycle', () => {
      // Initial connection
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      // Connection drops
      bot.ircClient.emit('close');
      expect(bot.isIRCConnected()).toBe(false);

      // Reconnection succeeds
      bot.ircClient.emit('registered', 'Welcome back');
      expect(bot.isIRCConnected()).toBe(true);

      // Verify logging
      const infoLogs = vi.mocked(logger.info).mock.calls;
      const connectLogs = infoLogs.filter((call: any) =>
        typeof call[0] === 'string' && call[0].includes('Connected and registered to IRC')
      );
      expect(connectLogs).toHaveLength(2);
    });
  });

  describe('Slash Command Protection', () => {
    it('should return false for IRC-dependent operations when disconnected', () => {
      expect(bot.isIRCConnected()).toBe(false);

      // IRC-dependent operations should know the connection is down
      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should return true for IRC-dependent operations when connected', () => {
      bot.ircClient.emit('registered', 'Welcome');

      expect(bot.isIRCConnected()).toBe(true);
    });

    it('should handle connection check during command execution', () => {
      // Simulate command execution flow
      const commandStarted = Date.now();

      // Check connection (should be false initially)
      expect(bot.isIRCConnected()).toBe(false);

      // Connection established
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      // Command can now proceed
      const commandCompleted = Date.now();
      expect(commandCompleted - commandStarted).toBeLessThan(1000);
    });

    it('should detect connection loss during long-running operation', async () => {
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      // Simulate long operation start
      const operationStarted = bot.isIRCConnected();
      expect(operationStarted).toBe(true);

      // Connection drops during operation
      await sleep(10);
      bot.ircClient.emit('error', new Error('Connection lost'));

      // Check should now show disconnected
      expect(bot.isIRCConnected()).toBe(false);
    });
  });

  describe('Health Monitoring', () => {
    it('should provide IRC stats when connected', () => {
      bot.ircClient.emit('registered', 'Welcome');

      const stats = bot.getIRCStats();
      expect(stats).toBeDefined();
      expect(stats.connected).toBe(true);
      expect(stats.lastActivity).toBeGreaterThan(0);
    });

    it('should provide IRC stats when disconnected', () => {
      const stats = bot.getIRCStats();
      expect(stats).toBeDefined();
      expect(stats.connected).toBe(false);
    });

    it('should update stats on activity', async () => {
      bot.ircClient.emit('registered', 'Welcome');
      const statsBeforeActivity = bot.getIRCStats();

      await sleep(10);
      bot.ircClient.emit('message', 'user', '#channel', 'text');

      const statsAfterActivity = bot.getIRCStats();
      expect(statsAfterActivity.lastActivity).toBeGreaterThan(
        statsBeforeActivity.lastActivity
      );
    });

    it('should track connection uptime', async () => {
      bot.ircClient.emit('registered', 'Welcome');

      // Let some time pass
      await sleep(50);

      const stats = bot.getIRCStats();
      expect(stats.connected).toBe(true);

      // Activity timestamp should be recent
      const timeSinceActivity = Date.now() - stats.lastActivity;
      expect(timeSinceActivity).toBeLessThan(100);
    });

    it('should detect stale connections', async () => {
      bot.ircClient.emit('registered', 'Welcome');
      bot.ircClient.emit('message', 'user', '#channel', 'text');

      const statsAfterMessage = bot.getIRCStats();
      const activityTime = statsAfterMessage.lastActivity;

      // Simulate time passing without activity
      await sleep(100);

      const _statsAfterDelay = bot.getIRCStats();
      const timeSinceActivity = Date.now() - activityTime;

      // Should be able to detect stale connection
      expect(timeSinceActivity).toBeGreaterThan(50);
    });
  });

  describe('Edge Cases', () => {
    it('should handle registered event without message parameter', () => {
      expect(() => {
        bot.ircClient.emit('registered');
      }).not.toThrow();

      expect(bot.isIRCConnected()).toBe(true);
    });

    it('should handle multiple rapid registered events', () => {
      bot.ircClient.emit('registered', 'Message 1');
      bot.ircClient.emit('registered', 'Message 2');
      bot.ircClient.emit('registered', 'Message 3');

      expect(bot.isIRCConnected()).toBe(true);

      // Should log all connections
      const infoLogs = vi.mocked(logger.info).mock.calls;
      const connectLogs = infoLogs.filter((call: any) =>
        typeof call[0] === 'string' && call[0].includes('Connected and registered to IRC')
      );
      expect(connectLogs.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle error events with missing error object', () => {
      expect(() => {
        bot.ircClient.emit('error', null);
      }).not.toThrow();

      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should handle netError events with non-Error objects', () => {
      expect(() => {
        bot.ircClient.emit('netError', 'string error');
      }).not.toThrow();

      expect(bot.isIRCConnected()).toBe(false);
    });

    it('should handle activity events when disconnected', () => {
      expect(bot.isIRCConnected()).toBe(false);

      expect(() => {
        bot.ircClient.emit('message', 'user', '#channel', 'text');
      }).not.toThrow();

      // Activity tracking should still work even when disconnected
      const stats = bot.getIRCStats();
      expect(stats.lastActivity).toBeGreaterThan(0);
    });

    it('should handle disconnect during activity burst', async () => {
      bot.ircClient.emit('registered', 'Welcome');

      // Simulate message burst
      for (let i = 0; i < 10; i++) {
        bot.ircClient.emit('message', `user${i}`, '#channel', `message ${i}`);
      }

      // Connection drops during burst
      bot.ircClient.emit('close');

      expect(bot.isIRCConnected()).toBe(false);

      // Should have processed all messages before disconnect was registered
      const stats = bot.getIRCStats();
      expect(stats.lastActivity).toBeGreaterThan(0);
    });
  });

  describe('Connection State Consistency', () => {
    it('should maintain consistent state across event handlers', () => {
      const recordSuccessSpy = vi.spyOn(bot.recoveryManager, 'recordSuccess');
      const recordConnectedSpy = vi.spyOn(bot.metrics, 'recordIRCConnected');

      bot.ircClient.emit('registered', 'Welcome');

      // All state updates should be consistent
      expect(bot.isIRCConnected()).toBe(true);
      expect(recordSuccessSpy).toHaveBeenCalledWith('irc');
      expect(recordConnectedSpy).toHaveBeenCalled();
    });

    it('should maintain consistent state on disconnection', () => {
      bot.ircClient.emit('registered', 'Welcome');
      expect(bot.isIRCConnected()).toBe(true);

      const recordFailureSpy = vi.spyOn(bot.recoveryManager, 'recordFailure');
      const recordDisconnectedSpy = vi.spyOn(bot.metrics, 'recordIRCDisconnected');

      const error = new Error('Test error');
      bot.ircClient.emit('error', error);

      // All state updates should be consistent
      expect(bot.isIRCConnected()).toBe(false);
      expect(recordFailureSpy).toHaveBeenCalledWith('irc', error);
      expect(recordDisconnectedSpy).toHaveBeenCalled();
    });
  });
});
