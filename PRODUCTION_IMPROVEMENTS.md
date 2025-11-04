# Production-Ready Improvements for irc-disc

## Critical Fixes Implemented
- ✅ v1.0.4: util.log polyfill for Node.js 24 compatibility
- ✅ v1.0.5: Defensive check for undefined message templates

## High-Priority Improvements Needed

### 1. WHOIS Flood Prevention (CRITICAL)
**Problem**: Bot gets kicked for "Excess Flood" when joining channels with many users
**Solution**: Implement response-aware WHOIS queue with timeout

```typescript
// lib/utils/response-aware-queue.ts
class ResponseAwareWhoisQueue {
  private queue: string[] = [];
  private isProcessing = false;
  private ircClient: any;
  private timeoutMs: number = 5000;

  // Wait for rpl_endofwhois (318) before processing next request
  // Includes timeout fallback to prevent queue stalling
}
```

**Impact**: Prevents disconnections, improves reliability

### 2. Config Validation with Zod (CRITICAL)
**Problem**: Undefined config properties cause crashes
**Solution**: Validate config at startup with Zod schema

```typescript
// lib/config/schema.ts
import { z } from 'zod';

export const configSchema = z.object({
  nickname: z.string().min(1),
  server: z.string().min(1),
  discordToken: z.string().min(1),
  channelMapping: z.record(z.string()),
  // All message templates with defaults
  quitMessage: z.string().default("*{nick}* has quit ({reason})"),
  // ... other fields
});
```

**Impact**: Fail-fast on invalid config, prevents runtime crashes

### 3. Discord.js Deprecation Fix (HIGH)
**Problem**: Using deprecated `message` event
**Solution**: Replace with `messageCreate`

```typescript
// In bot.ts
- discordClient.on('message', handler);
+ discordClient.on('messageCreate', handler);
```

**Impact**: Prepares for Discord.js v14, removes console warnings

### 4. Promise.allSettled for Multi-Channel Delivery (HIGH)
**Problem**: One channel failure prevents delivery to other channels
**Solution**: Use Promise.allSettled for parallel operations

```typescript
const results = await Promise.allSettled(
  channels.map(ch => ch.send(message))
);
results.forEach(result => {
  if (result.status === 'rejected') {
    logger.error('Channel delivery failed:', result.reason);
  }
});
```

**Impact**: Improved reliability for multi-channel setups

### 5. SQLite Improvements (MEDIUM)
**Problem**: SQLITE_BUSY errors under load
**Solution**: Enable WAL mode + retry logic

```typescript
await db.run('PRAGMA journal_mode = WAL;');

async function writeWithRetry(query, params, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await db.run(query, params);
    } catch (error) {
      if (error.code === 'SQLITE_BUSY') {
        await delay(50 * (i + 1)); // Exponential backoff
      } else throw error;
    }
  }
}
```

**Impact**: Better concurrency, fewer write failures

### 6. Global Error Handlers (CRITICAL)
**Problem**: Uncaught exceptions crash the process silently
**Solution**: Add process-level error handlers

```typescript
// In index.ts or main entry point
process.on('uncaughtException', (error, origin) => {
  logger.error(`[FATAL] Uncaught Exception at: ${origin}`, error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
```

**Impact**: Proper error logging, clean shutdown, enables auto-restart

### 7. Event Listener Cleanup (MEDIUM)
**Problem**: Potential memory leaks from dynamically created listeners
**Solution**: Track and cleanup listeners

```typescript
class IrcUserTracker {
  private trackedNicks: Map<string, Function> = new Map();

  startTracking(nick: string) {
    const listener = (from, to, text) => { /* ... */ };
    this.trackedNicks.set(nick, listener);
    this.ircClient.on('message', listener);
  }

  stopTracking(nick: string) {
    const listener = this.trackedNicks.get(nick);
    if (listener) {
      this.ircClient.removeListener('message', listener);
      this.trackedNicks.delete(nick);
    }
  }

  destroy() {
    for (const [nick, listener] of this.trackedNicks) {
      this.ircClient.removeListener('message', listener);
    }
    this.trackedNicks.clear();
  }
}
```

**Impact**: Prevents memory leaks in long-running processes

## Implementation Priority

1. **v1.0.6** (Immediate):
   - Global error handlers (5 min)
   - Discord.js messageCreate fix (2 min)

2. **v1.1.0** (Next release):
   - Zod config validation
   - Response-aware WHOIS queue
   - Promise.allSettled for message delivery

3. **v1.2.0** (Future):
   - SQLite WAL mode + retry logic
   - Event listener cleanup patterns
   - Comprehensive error recovery system

## Testing Strategy

1. **WHOIS Queue**: Join channel with 100+ users, verify no flood kicks
2. **Config Validation**: Test with invalid/missing config fields
3. **Multi-channel**: Test message delivery when one channel is deleted
4. **SQLite**: Simulate concurrent writes
5. **Error Handlers**: Force exceptions, verify logging and restart

## Monitoring Recommendations

- Track WHOIS queue length and processing time
- Monitor channel delivery success rates
- Alert on repeated uncaught exceptions
- Track SQLite BUSY occurrences
- Memory usage over time (detect leaks)

## Dependencies

- zod: ^4.1.12 (config validation)
- Existing: sqlite3, discord.js, irc-upd, winston

## Consul Gemini for Additional Patterns

- Circuit breaker for external services (S3)
- Rate limiting for IRC commands
- Health check endpoints
- Graceful shutdown procedures
