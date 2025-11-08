# Webhook Feature Specification

## Overview
Enable IRC→Discord messages to appear as regular Discord messages with custom usernames and avatars using Discord webhooks, instead of appearing as bot messages.

## Requirements

### Functional Requirements
1. **Webhook Configuration**: Bot must accept webhook URLs in config per Discord channel
2. **Username Override**: IRC nicknames must appear as Discord message author names
3. **Avatar Override**: IRC users should have avatars (from member cache or pattern URL)
4. **Fallback Behavior**: If webhook unavailable, fall back to normal bot messages
5. **Mention Handling**: Preserve existing mention conversion and ping controls

### Technical Requirements
1. **Discord.js v13+ Compatibility**: Use modern `WebhookClient` and `webhook.send()` syntax
2. **Username Length**: Pad IRC nicknames to 2-32 characters (Discord requirement)
3. **Member Cache**: Utilize GUILD_MEMBERS intent to lookup user avatars
4. **Error Handling**: Gracefully handle webhook failures without crashing

## Configuration Schema

```json
{
  "webhooks": {
    "708438748961964055": "https://discord.com/api/webhooks/709020378865074226/TOKEN",
    "1348548317092778005": "https://discord.com/api/webhooks/1348552365623738418/TOKEN"
  },
  "formatWebhookAvatarURL": "https://robohash.org/{nickname}?size=128" // Optional fallback
}
```

## Implementation Components

### 1. Type Definitions
```typescript
import { WebhookClient } from 'discord.js';

// Bot class properties:
webhooks: Record<string, { id: string; client: WebhookClient }>;
webhookOptions?: Record<string, string>;
formatWebhookAvatarURL?: string;
```

### 2. Webhook Initialization
Parse webhook URLs from config and create WebhookClient instances during bot connection.

### 3. Helper Methods

#### `findWebhook(ircChannel: string)`
- Map IRC channel to Discord channel ID
- Return webhook client if configured for that channel
- Return undefined if no webhook

#### `getDiscordAvatar(nick: string, channel: string)`
- Look up Discord guild member by nickname (case-insensitive)
- Return member's avatar URL if found
- Fall back to `formatWebhookAvatarURL` pattern if configured
- Return undefined if no avatar available

### 4. Message Sending Logic
When sending IRC message to Discord:
1. Check if webhook exists for target channel
2. If webhook: Use `webhook.send()` with username and avatar overrides
3. If no webhook: Use existing `channel.send()` method
4. Preserve mention conversion and ping controls in both paths

## Discord.js v13+ Webhook Syntax

**Correct (v13+)**:
```typescript
webhook.client.send({
  content: messageContent,
  username: paddedUsername,
  avatarURL: avatarURL,
  allowedMentions: {
    parse: canPingEveryone ? ['users', 'roles', 'everyone'] : ['users', 'roles'],
  },
});
```

**Deprecated (v12)**: ❌
```typescript
webhook.client.sendMessage(content, {
  username,
  avatarURL,
  disableEveryone: !canPingEveryone,
});
```

## Acceptance Criteria

- [ ] Webhook URLs parsed from config during initialization
- [ ] WebhookClient instances created for each configured channel
- [ ] IRC messages sent via webhook when configured
- [ ] IRC nicknames appear as Discord message authors
- [ ] Avatars displayed (from member cache or fallback URL)
- [ ] Username padding applied (2-32 characters)
- [ ] Mention conversion preserved
- [ ] Ping controls (everyone/here) respected
- [ ] Graceful fallback to bot messages when webhook unavailable
- [ ] No errors or crashes when webhook fails
- [ ] Build succeeds without TypeScript errors
- [ ] Feature documented in WORKING.md

## References
- Old implementation: git commit 88fecf3 (JavaScript version)
- Discord.js v13 WebhookClient: https://discord.js.org/#/docs/discord.js/main/class/WebhookClient
- Discord username requirements: 2-32 characters
