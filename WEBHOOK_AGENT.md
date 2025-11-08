# Webhook Feature Implementation Agent

## Status: IN PROGRESS

## Objective
Implement Discord webhook support for IRC→Discord messages to display IRC users as regular Discord users with custom names and avatars.

## Context Checkpoint
**Last Updated**: 2025-11-08

**Problem**: Webhook feature completely missing from TypeScript codebase (removed during refactor)

**Solution**: Implement from scratch using modern discord.js v13+ API

**Key Files**:
- `/data/data/com.termux/files/home/git/discord-irc/lib/bot.ts` - Main implementation
- `/data/data/com.termux/files/home/git/dirc/config.json` - Contains webhook URLs
- `WEBHOOK_SPEC.md` - Feature specification

## Implementation Checklist

### Phase 1: Setup ✅
- [x] Create WEBHOOK_SPEC.md with requirements
- [x] Create WEBHOOK_AGENT.md for progress tracking
- [ ] Read bot.ts to understand current structure

### Phase 2: Type Definitions & Properties
- [ ] Add WebhookClient import from discord.js
- [ ] Add webhook property types to Bot class
- [ ] Add webhook-related config properties

### Phase 3: Initialization
- [ ] Parse webhookOptions from config in constructor
- [ ] Initialize webhooks Map in constructor
- [ ] Add webhook setup in connect() method
- [ ] Log webhook initialization status

### Phase 4: Helper Methods
- [ ] Implement findWebhook(ircChannel) method
- [ ] Implement getDiscordAvatar(nick, channel) method
- [ ] Add username padding utility (2-32 chars)

### Phase 5: Message Handler Integration
- [ ] Locate IRC message handler (where messages sent to Discord)
- [ ] Add webhook availability check
- [ ] Implement webhook.send() path with modern syntax
- [ ] Preserve existing fallback path for non-webhook channels
- [ ] Preserve mention conversion logic

### Phase 6: Testing & Documentation
- [ ] Build TypeScript (npm run build)
- [ ] Test with real Discord webhook
- [ ] Verify username override works
- [ ] Verify avatar override works
- [ ] Verify mention handling preserved
- [ ] Update WORKING.md with implementation notes
- [ ] Create conventional commit

## Implementation Notes

### Discord.js v13+ Webhook API
```typescript
// Correct syntax
await webhook.client.send({
  content: string,
  username: string,      // 2-32 characters
  avatarURL: string,
  allowedMentions: {
    parse: ['users', 'roles'] | ['users', 'roles', 'everyone']
  }
});
```

### Username Padding
Discord requires 2-32 characters for webhook usernames:
```typescript
const paddedUsername = username.padEnd(2, '_').slice(0, 32);
```

### Config Structure
```json
{
  "webhooks": {
    "<discord_channel_id>": "https://discord.com/api/webhooks/<id>/<token>"
  },
  "formatWebhookAvatarURL": "https://robohash.org/{nickname}?size=128"
}
```

## Current Blocker
None - ready to implement

## Next Action
Read bot.ts to locate IRC message handler and understand current message flow

## Rollback Plan
If implementation fails:
1. Git stash changes
2. Bot continues working without webhooks (existing fallback path)
3. Review errors and retry

## Testing Strategy
1. Build with `npm run build`
2. Start bot with test config containing webhook URLs
3. Send IRC message
4. Verify Discord shows IRC nickname as author (not bot name)
5. Verify avatar displayed (not bot avatar)
6. Verify mentions still work

## Success Criteria
- IRC messages appear in Discord with IRC nickname as author
- Avatars displayed from member cache or fallback URL
- No TypeScript compilation errors
- No runtime errors or crashes
- Existing functionality preserved
- Tests pass

## Archive Summary (Avoid Context Poisoning)
**What Happened Before**: Fixed event loop blocking, DNS resolution, and missing intents. Bot now connects successfully to both Discord and IRC.

**What We're Doing Now**: Implementing missing webhook feature for prettier IRC→Discord messages.

**What's Next**: After webhook feature works, update docs and commit.
