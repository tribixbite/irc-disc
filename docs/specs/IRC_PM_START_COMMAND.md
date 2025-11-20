# IRC PM Command Specification

## Overview

Add `/pm <nickname> [message]` command to open or switch to a PM thread with an IRC user. Creates thread if needed, or returns existing thread link.

## Current System

### Existing PM Flow (IRC-initiated)
1. IRC user sends PM to bot
2. Bot creates Discord thread in PM channel named "PM: nickname"
3. Thread ID stored in `bot.pmThreads` (LRUCache) and `bot.persistence` (SQLite)
4. Discord user replies in thread → `handleDiscordPrivateMessage()` routes to IRC
5. Future IRC PMs from same user reuse the thread

### Existing Infrastructure
- `bot.pmThreads`: LRUCache<string, string> mapping nickname → threadId
- `bot.persistence.savePMThread(nickname, threadId)`: Persist to SQLite
- `bot.persistence.deletePMThread(nickname)`: Remove from SQLite
- `bot.pmChannelId`: Configured PM channel ID
- `bot.pmThreadPrefix`: "PM: " (default)
- `handleDiscordPrivateMessage()`: Routes thread messages to IRC

## New Feature: `/pm`

### Command Signature
```
/pm <nickname> [message]
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| nickname | STRING | Yes | IRC nickname to PM |
| message | STRING | No | Optional message to send immediately |

### Behavior

#### Primary Action
Returns a link to the PM thread for that user - either existing or newly created.

#### Thread Management
1. **Check existing thread**: Look up `bot.pmThreads.get(nickname.toLowerCase())`
2. **Validate thread exists on Discord**: Fetch thread, handle if deleted
3. **Unarchive if needed**: Reactivate archived threads
4. **Create new if needed**: Create thread named "PM: nickname"
5. **Update state**: Persist to database, then update cache

#### Response
- Always returns: `💬 PM with **nickname**: <#threadId>`
- User clicks the link to "enter" the thread

#### Message Routing
- Uses same `handleDiscordPrivateMessage()` as IRC-initiated threads
- No changes needed to routing logic - it's thread-based, not origin-based

#### Initial Message Handling
- If message provided, send to IRC via `bot.ircClient.say(nickname, message)`
- Post confirmation in Discord thread with attribution
- Format: `**<DiscordUser>** message content`

### State Management Order
1. Create thread on Discord (get threadId)
2. Persist to database: `await bot.persistence.savePMThread(nickname, threadId)`
3. Update cache: `bot.pmThreads.set(nickname.toLowerCase(), threadId)`

This "persist-then-cache" order ensures resilience on crash.

## Implementation Details

### Execute Function Flow

```typescript
async execute(interaction: CommandInteraction, bot: Bot) {
  // 1. Permission check
  if (!hasAdminPermission(interaction)) {
    return ephemeralError('Need admin permissions');
  }

  // 2. Defer reply (operations may be slow)
  await interaction.deferReply({ ephemeral: true });

  // 3. Get parameters
  const nickname = interaction.options.getString('nickname', true);
  const message = interaction.options.getString('message');
  const normalizedNick = nickname.toLowerCase();

  // 4. Validate PM channel configured
  if (!bot.pmChannelId) {
    return editReplyError('PM channel not configured');
  }

  // 5. Get PM channel
  const pmChannel = await bot.discord.channels.fetch(bot.pmChannelId);
  if (!pmChannel?.isText()) {
    return editReplyError('PM channel not found or invalid');
  }

  // 6. Find or create thread
  let thread: ThreadChannel;
  const existingThreadId = bot.pmThreads.get(normalizedNick);

  if (existingThreadId) {
    // Try to fetch existing thread
    try {
      const fetched = await bot.discord.channels.fetch(existingThreadId);
      if (fetched?.isThread()) {
        thread = fetched;
        // Unarchive if needed
        if (thread.archived) {
          await thread.setArchived(false);
        }
      } else {
        throw new Error('Not a thread');
      }
    } catch {
      // Thread was deleted - clean up stale state
      bot.pmThreads.delete(normalizedNick);
      if (bot.persistence) {
        await bot.persistence.deletePMThread(nickname);
      }
      // Will create new thread below
      thread = null;
    }
  }

  if (!thread) {
    // Create new thread
    try {
      thread = await pmChannel.threads.create({
        name: `${bot.pmThreadPrefix}${nickname}`,
        autoArchiveDuration: bot.pmAutoArchive,
        reason: `PM thread initiated from Discord for ${nickname}`
      });

      // Persist then cache
      if (bot.persistence) {
        await bot.persistence.savePMThread(nickname, thread.id);
      }
      bot.pmThreads.set(normalizedNick, thread.id);

    } catch (error) {
      return editReplyError(`Failed to create thread: ${error.message}`);
    }
  }

  // 7. Reply with thread link
  await interaction.editReply({
    content: `✅ PM thread with **${nickname}** is ready: <#${thread.id}>`
  });

  // 8. Handle initial message
  if (message) {
    try {
      // Send to IRC
      bot.ircClient.say(nickname, message);

      // Post in thread with attribution
      const author = interaction.user.username;
      await thread.send(`**<${author}>** ${message}`);

      // Record metrics
      bot.metrics.recordDiscordToIRC(interaction.user.id, nickname);

    } catch (error) {
      await thread.send(`⚠️ **Failed to send message to IRC:** ${error.message}`);
    }
  }
}
```

### Error Handling

| Error Case | Response |
|------------|----------|
| No admin permission | Ephemeral: "Need administrator permissions" |
| PM channel not configured | Ephemeral: "PM channel not configured by admin" |
| PM channel not found | Ephemeral: "PM channel not found or invalid" |
| Thread creation failed | Ephemeral: "Failed to create thread: [error]" |
| IRC send failed | In-thread: "⚠️ Failed to send message: [error]" |
| IRC user not found | In-thread: "⚠️ User not found on IRC server" |

### Edge Cases

1. **Thread already exists**: Reuse it, unarchive if needed
2. **Thread was deleted**: Clean up state, create new one
3. **IRC user doesn't exist**: Optimistic send, handle error asynchronously
4. **Rate limiting**: Discord API may reject, return clear error
5. **Missing permissions**: Bot needs "Create Public Threads" permission

## Changes Required

### 1. Create new pmCommand in slash-commands.ts

Create a new standalone command (separate from `/irc-pm` management commands):
```typescript
export const pmCommand: SlashCommand = {
  data: {
    name: 'pm',
    description: 'Open or create a PM thread with an IRC user',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        name: 'nickname',
        description: 'IRC nickname to message',
        type: 'STRING' as const,
        required: true,
      },
      {
        name: 'message',
        description: 'Optional message to send immediately',
        type: 'STRING' as const,
        required: false,
      }
    ]
  },
  async execute(interaction, bot) {
    // Implementation here
  }
};
```

### 2. Add to slashCommands array

Export the new command in the slashCommands array.

### 3. No changes to bot.ts

The existing `handleDiscordPrivateMessage()` will work for Discord-initiated threads because:
- It routes based on thread ID lookup in `bot.pmThreads`
- Origin of thread creation is irrelevant
- State is the same regardless of who initiated

## Testing Plan

### Unit Tests
- [ ] Test thread reuse when exists
- [ ] Test thread creation when none exists
- [ ] Test unarchive of archived thread
- [ ] Test cleanup of deleted thread
- [ ] Test initial message sending
- [ ] Test error handling for each case

### Integration Tests
- [ ] Full flow: start → send message → receive reply
- [ ] Thread persistence across bot restart
- [ ] Concurrent starts for same nickname

### Manual Tests
- [ ] Verify commands appear in Discord
- [ ] Test with real IRC user
- [ ] Test with non-existent IRC user
- [ ] Test permission requirements

## Metrics

Track with existing metrics:
- `bot.metrics.recordDiscordToIRC()` - for initial message
- `bot.metrics.recordPMThreadCreated()` - for new threads

## Security Considerations

- Admin-only command (existing pattern)
- Nickname sanitization already in place
- No exposure of internal state to users

## Future Enhancements

1. **Nickname validation**: Check if IRC user exists before creating thread
2. **Auto-complete**: Suggest online IRC users
3. **Bulk start**: Start threads for multiple users
4. **Templates**: Pre-defined message templates
