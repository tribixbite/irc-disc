import {
  CommandInteraction,
  ButtonInteraction,
  Permissions,
  MessageEmbed,
  MessageAttachment,
  ApplicationCommandData,
  TextChannel,
  ThreadChannel,
  MessageActionRow,
  MessageButton
} from 'discord.js';
import { logger } from './logger';
import Bot from './bot';
import { S3Uploader } from './s3-uploader';
import type { S3Config } from './persistence';
import { IRCChannelUser, IRCChannelListItem, IRCUserInfo } from './irc-user-manager';
import { createDefaultS3RateLimiter } from './s3-rate-limiter';

// Global S3 upload rate limiter (5 uploads per 10 minutes per user)
const s3RateLimiter = createDefaultS3RateLimiter();

export interface SlashCommand {
  data: ApplicationCommandData;
  execute: (interaction: CommandInteraction, bot: Bot) => Promise<void>;
}

// Admin permission check
function hasAdminPermission(interaction: CommandInteraction): boolean {
  if (!interaction.member || !interaction.guild) return false;

  // Check if user has administrator permission
  if (typeof interaction.member.permissions === 'string') return false;
  return interaction.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR);
}

/**
 * Share S3 file URL to IRC channel
 * Formats message with optional URL shortener and sends to mapped IRC channel
 */
function shareToIRC(
  bot: Bot,
  discordChannelId: string,
  username: string,
  filename: string,
  fullUrl: string,
  urlShortenerPrefix?: string
): boolean {
  // Find the IRC channel mapped to this Discord channel
  const ircChannel = bot.channelMapping[discordChannelId];
  if (!ircChannel) {
    logger.warn(`No IRC channel mapping found for Discord channel ${discordChannelId}`);
    return false;
  }

  // Build the URL to share (shortened if prefix is configured)
  let message: string;

  if (urlShortenerPrefix) {
    // Use only the shortened URL when configured
    const urlFilename = filename.split('/').pop() || filename;
    const shortUrl = `${urlShortenerPrefix}${urlFilename}`;
    message = `${username} uploaded ${filename} - ${shortUrl}`;
  } else {
    // Use full URL when no shortener configured
    message = `${username} uploaded ${filename} - ${fullUrl}`;
  }

  // Send message to IRC
  try {
    bot.ircClient.say(ircChannel, message);
    logger.debug(`Shared S3 file to IRC: ${ircChannel} - ${filename}`);
    return true;
  } catch (error) {
    logger.error(`Failed to share S3 file to IRC:`, error);
    return false;
  }
}

// Status command - show bot health and stats
export const statusCommand: SlashCommand = {
  data: {
    name: 'irc-status',
    description: 'Show IRC bridge status and statistics',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const embed = new MessageEmbed()
        .setTitle('🔗 IRC Bridge Status')
        .setColor(0x00ff00)
        .setTimestamp();

      // Basic bot info
      embed.addField('🌐 IRC Server', `${bot.server}`, true);
      embed.addField('👤 Bot Nickname', `${bot.nickname}`, true);
      embed.addField('📊 Channels Mapped', `${Object.keys(bot.channelMapping).length}`, true);

      // Channel users info
      const totalTrackedUsers = Object.values(bot.channelUsers)
        .reduce((total: number, users) => total + (users as Set<string>).size, 0);
      
      embed.addField('👥 Tracked IRC Users', `${totalTrackedUsers}`, true);
      embed.addField('💬 PM Threads', `${bot.pmThreads.size}`, true);
      embed.addField('🏠 PM Channel', bot.pmChannelId ? `<#${bot.pmChannelId}>` : 'Not configured', true);

      // Message sync stats
      const syncStats = bot.messageSync.getStats();
      embed.addField('📝 Tracked Messages', `${syncStats.trackedMessages}`, true);
      embed.addField('⏰ Edit Window', `${syncStats.editWindowMinutes} min`, true);

      // Rate limiting stats
      const rateLimitStats = bot.rateLimiter.getStats();
      embed.addField('🚫 Blocked Users', `${rateLimitStats.blockedUsers}`, true);
      embed.addField('⚠️ Recent Warnings', `${rateLimitStats.recentWarnings}`, true);
      embed.addField('👤 Active Users', `${rateLimitStats.activeUsers}`, true);

      // Recovery health status
      const recoveryHealth = bot.recoveryManager.getHealthStatus();
      const discordHealth = recoveryHealth.discord.isHealthy ? '✅' : '❌';
      const ircHealth = recoveryHealth.irc.isHealthy ? '✅' : '❌';
      embed.addField('🟦 Discord Health', discordHealth, true);
      embed.addField('⚫ IRC Health', ircHealth, true);
      embed.addField('🔄 Recovery Active', recoveryHealth.isRecovering ? '🔄 Yes' : '⏸️ No', true);

      // Get some persistence metrics
      if (bot.persistence) {
        try {
          const uptime = await bot.persistence.getMetric('uptime_start');
          if (uptime) {
            const startTime = parseInt(uptime);
            const uptimeMs = Date.now() - startTime;
            const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
            embed.addField('⏱️ Uptime', `${uptimeHours} hours`, true);
          }
        } catch (error) {
          logger.warn('Failed to get uptime metric:', error);
        }
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (error) {
      logger.error('Error in status command:', error);
      await interaction.reply({ 
        content: '❌ Failed to retrieve status information.', 
        ephemeral: true 
      });
    }
  }
};

// Channel users command - list users in IRC channels
export const usersCommand: SlashCommand = {
  data: {
    name: 'irc-users',
    description: 'List users in IRC channels',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        name: 'channel',
        description: 'IRC channel name (without #)',
        type: 'STRING' as const,
        required: false,
      }
    ]
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const channelName = interaction.options.getString('channel');
      const embed = new MessageEmbed()
        .setTitle('👥 IRC Channel Users')
        .setColor(0x0099ff)
        .setTimestamp();

      if (channelName) {
        // Show users for specific channel with enhanced info
        const fullChannelName = channelName.startsWith('#') ? channelName : `#${channelName}`;
        const lowerChannelName = fullChannelName.toLowerCase();
        const users = bot.channelUsers[lowerChannelName];
        
        if (users && users.size > 0) {
          const userList = Array.from(users).sort().join(', ');
          embed.addField(
            `${fullChannelName} (${users.size} users)`, 
            userList.length > 1024 ? userList.substring(0, 1021) + '...' : userList
          );
          
          // Show enhanced channel info from IRC User Manager
          const channelInfo = bot.ircUserManager.getChannelInfo(fullChannelName);
          if (channelInfo) {
            const operatorCount = Array.from(channelInfo.users.values()).filter(u => u.isOperator).length;
            const voicedCount = Array.from(channelInfo.users.values()).filter(u => u.isVoiced && !u.isOperator).length;
            
            if (operatorCount > 0 || voicedCount > 0) {
              let statusInfo = '';
              if (operatorCount > 0) statusInfo += `👑 ${operatorCount} operators`;
              if (voicedCount > 0) {
                if (statusInfo) statusInfo += ', ';
                statusInfo += `🗣️ ${voicedCount} voiced`;
              }
              embed.addField('Channel Status', statusInfo, true);
            }
            
            if (channelInfo.topic) {
              const shortTopic = channelInfo.topic.length > 200 
                ? `${channelInfo.topic.substring(0, 200)}...`
                : channelInfo.topic;
              embed.addField('Topic', shortTopic, false);
            }
          }
        } else {
          embed.addField(
            fullChannelName, 
            'No users tracked (channel not found or not joined)'
          );
        }
      } else {
        // Show all channels and user counts with enhanced stats
        const channels = Object.keys(bot.channelUsers).sort();
        if (channels.length === 0) {
          embed.setDescription('No IRC channels are currently being tracked.');
        } else {
          const stats = bot.ircUserManager.getStats();
          
          const channelInfo = channels.map(channel => {
            const userCount = bot.channelUsers[channel].size;
            const channelData = bot.ircUserManager.getChannelInfo(channel);
            let info = `**${channel}**: ${userCount} users`;
            
            if (channelData) {
              const opCount = Array.from(channelData.users.values()).filter(u => u.isOperator).length;
              const voiceCount = Array.from(channelData.users.values()).filter(u => u.isVoiced && !u.isOperator).length;
              if (opCount > 0 || voiceCount > 0) {
                info += ` (👑${opCount}`;
                if (voiceCount > 0) info += ` 🗣️${voiceCount}`;
                info += ')';
              }
            }
            
            return info;
          }).join('\n');
          
          const description = `**${stats.totalUsers}** total users tracked across **${stats.totalChannels}** channels\n💡 *Use /irc-userinfo and /irc-channelinfo for detailed information*\n\n${channelInfo}`;
          embed.setDescription(description.length > 4096 ? 
            description.substring(0, 4093) + '...' : description);
        }
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (error) {
      logger.error('Error in users command:', error);
      await interaction.reply({ 
        content: '❌ Failed to retrieve user information.', 
        ephemeral: true 
      });
    }
  }
};

// PM management command
export const pmCommand: SlashCommand = {
  data: {
    name: 'irc-pm',
    description: 'Manage IRC private message threads',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        name: 'list',
        description: 'List active PM threads',
        type: 'SUB_COMMAND' as const,
      },
      {
        name: 'cleanup',
        description: 'Clean up inactive PM threads',
        type: 'SUB_COMMAND' as const,
      },
      {
        name: 'close',
        description: 'Close a specific PM thread',
        type: 'SUB_COMMAND' as const,
        options: [
          {
            name: 'nickname',
            description: 'IRC nickname to close PM thread for',
            type: 'STRING' as const,
            required: true,
          }
        ]
      }
    ]
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    
    try {
      switch (subcommand) {
        case 'list': {
          const embed = new MessageEmbed()
            .setTitle('💬 Active PM Threads')
            .setColor(0xff9900)
            .setTimestamp();

          if (bot.pmThreads.size === 0) {
            embed.setDescription('No active PM threads.');
          } else {
            const threadList = Array.from(bot.pmThreads.entries())
              .map(([nick, threadId]) => `**${nick}**: <#${threadId}>`)
              .join('\n');
            
            embed.setDescription(threadList.length > 4096 ? 
              threadList.substring(0, 4093) + '...' : threadList);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }
        
        case 'cleanup': {
          if (!bot.persistence) {
            await interaction.reply({ 
              content: '❌ Persistence service not available.', 
              ephemeral: true 
            });
            return;
          }

          await bot.persistence.cleanup();
          await interaction.reply({ 
            content: '✅ PM thread cleanup completed.', 
            ephemeral: true 
          });
          break;
        }
        
        case 'close': {
          const nickname = interaction.options.getString('nickname', true);
          const threadId = bot.pmThreads.get(nickname.toLowerCase());
          
          if (!threadId) {
            await interaction.reply({ 
              content: `❌ No active PM thread found for ${nickname}.`, 
              ephemeral: true 
            });
            return;
          }

          // Remove from memory
          bot.pmThreads.delete(nickname.toLowerCase());
          
          // Remove from persistence
          if (bot.persistence) {
            await bot.persistence.deletePMThread(nickname);
          }

          // Try to archive the thread
          try {
            const channel = await bot.discord.channels.fetch(threadId);
            if (channel?.isThread()) {
              await channel.setArchived(true);
            }
          } catch (error) {
            logger.warn('Failed to archive thread:', error);
          }

          await interaction.reply({ 
            content: `✅ Closed PM thread for ${nickname}.`, 
            ephemeral: true 
          });
          break;
        }
        
        default:
          await interaction.reply({ 
            content: '❌ Unknown subcommand.', 
            ephemeral: true 
          });
      }
      
    } catch (error) {
      logger.error('Error in PM command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute PM command.', 
        ephemeral: true 
      });
    }
  }
};

// Direct PM command - open or create a PM thread with an IRC user
export const directPmCommand: SlashCommand = {
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

  async execute(interaction: CommandInteraction, bot: Bot) {
    // Permission check
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({
        content: '❌ You need administrator permissions to use this command.',
        ephemeral: true
      });
      return;
    }

    // Defer reply for potentially slow operations
    await interaction.deferReply({ ephemeral: true });

    // Get parameters
    const nickname = interaction.options.getString('nickname', true);
    const message = interaction.options.getString('message');
    const normalizedNick = nickname.toLowerCase();

    try {
      // Use current channel or configured PM channel
      const channelId = bot.pmChannelId || interaction.channelId;

      // Get PM channel (either configured or current)
      const pmChannel = await bot.discord.channels.fetch(channelId);
      if (!pmChannel || !pmChannel.isText()) {
        await interaction.editReply({
          content: '❌ Channel not found or is not a text channel.'
        });
        return;
      }

      let thread: ThreadChannel | null = null;
      const existingThreadId = bot.pmThreads.get(normalizedNick);

      // Try to reuse existing thread
      if (existingThreadId) {
        try {
          const fetched = await bot.discord.channels.fetch(existingThreadId);
          if (fetched?.isThread()) {
            thread = fetched;

            // Unarchive if needed
            if (thread.archived) {
              await thread.setArchived(false);
              logger.info(`Unarchived PM thread for ${nickname}`);
            }
          } else {
            throw new Error('Channel is not a thread');
          }
        } catch (fetchError) {
          // Thread was deleted - clean up stale state
          logger.warn(`Cleaning up stale PM thread for ${nickname}:`, fetchError);
          bot.pmThreads.delete(normalizedNick);
          if (bot.persistence) {
            await bot.persistence.deletePMThread(nickname);
          }
          // Will create new thread below
        }
      }

      // Create new thread if needed
      if (!thread) {
        try {
          thread = await (pmChannel as TextChannel).threads.create({
            name: `${bot.pmThreadPrefix}${nickname}`,
            autoArchiveDuration: bot.pmAutoArchive as 60 | 1440 | 4320 | 10080,
            reason: `PM thread initiated from Discord for ${nickname}`
          });

          // Persist then cache (crash resilience)
          if (bot.persistence) {
            await bot.persistence.savePMThread(nickname, thread.id, channelId);
          }
          bot.pmThreads.set(normalizedNick, thread.id);

          logger.info(`Created new PM thread for ${nickname}: ${thread.id}`);
          bot.metrics.recordPMThreadCreated();

        } catch (createError) {
          logger.error(`Failed to create PM thread for ${nickname}:`, createError);
          await interaction.editReply({
            content: `❌ Failed to create thread: ${(createError as Error).message}`
          });
          return;
        }
      }

      // Reply with thread link
      await interaction.editReply({
        content: `💬 PM with **${nickname}**: <#${thread.id}>`
      });

      // Handle optional initial message
      if (message && thread) {
        try {
          // Send to IRC
          bot.ircClient.say(nickname, message);

          // Post in thread with attribution
          const author = interaction.user.username;
          await thread.send(`**<${author}>** ${message}`);

          // Record metrics
          bot.metrics.recordDiscordToIRC(interaction.user.id, nickname);
          bot.metrics.recordPMMessage();

          logger.debug(`Sent initial PM to ${nickname}: ${message.substring(0, 50)}...`);

        } catch (sendError) {
          logger.error(`Failed to send initial message to ${nickname}:`, sendError);
          await thread.send(`⚠️ **Failed to send message to IRC:** ${(sendError as Error).message}`);
        }
      }

    } catch (error) {
      logger.error('Error in direct PM command:', error);
      await interaction.editReply({
        content: '❌ Failed to execute PM command.'
      });
    }
  }
};

// Reconnect command - force IRC reconnection
export const reconnectCommand: SlashCommand = {
  data: {
    name: 'irc-reconnect',
    description: 'Force IRC client to reconnect',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      await interaction.reply({ 
        content: '🔄 Initiating IRC reconnection...', 
        ephemeral: true 
      });

      // Disconnect and reconnect IRC client
      bot.ircClient.disconnect('Manual reconnect requested', () => {
        logger.info('IRC client disconnected for manual reconnection');
        // Give it a moment before reconnecting
        setTimeout(() => {
          bot.ircClient.connect();
        }, 2000);
      });
      
    } catch (error) {
      logger.error('Error in reconnect command:', error);
      await interaction.followUp({ 
        content: '❌ Failed to reconnect IRC client.', 
        ephemeral: true 
      });
    }
  }
};

// Rate limit management command
export const rateLimitCommand: SlashCommand = {
  data: {
    name: 'irc-ratelimit',
    description: 'Manage IRC bridge rate limiting',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'status',
        description: 'Show detailed rate limit statistics'
      },
      {
        type: 'SUB_COMMAND',
        name: 'blocked',
        description: 'List currently blocked users'
      },
      {
        type: 'SUB_COMMAND',
        name: 'unblock',
        description: 'Unblock a specific user',
        options: [
          {
            type: 'STRING',
            name: 'user',
            description: 'Username or user ID to unblock',
            required: true
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'clear',
        description: 'Clear warnings for a specific user',
        options: [
          {
            type: 'STRING',
            name: 'user',
            description: 'Username or user ID to clear warnings for',
            required: true
          }
        ]
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'status': {
          const stats = bot.rateLimiter.getStats();
          const embed = new MessageEmbed()
            .setTitle('🚦 Rate Limiting Statistics')
            .setColor('#FFA500')
            .addField('Total Users Tracked', `${stats.totalUsers}`, true)
            .addField('Currently Blocked', `${stats.blockedUsers}`, true)
            .addField('Active Users (1h)', `${stats.activeUsers}`, true)
            .addField('Recent Warnings (24h)', `${stats.recentWarnings}`, true)
            .addField('Total Messages Processed', `${stats.totalMessages}`, true)
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'blocked': {
          const blockedUsers = bot.rateLimiter.getBlockedUsers();
          
          if (blockedUsers.length === 0) {
            await interaction.reply({ 
              content: '✅ No users are currently blocked.', 
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle('🚫 Currently Blocked Users')
            .setColor('#FF0000')
            .setTimestamp();

          const now = Date.now();
          const userList = blockedUsers.slice(0, 25).map(user => {
            const remainingTime = Math.ceil((user.blockedUntil - now) / 1000);
            const userType = user.userId.startsWith('irc:') ? 'IRC' : 'Discord';
            const displayName = user.userId.startsWith('irc:') ? user.userId.slice(4) : user.username;
            return `**${displayName}** (${userType}) - ${remainingTime}s remaining (${user.warningCount} warnings)`;
          }).join('\n');

          embed.setDescription(userList);
          
          if (blockedUsers.length > 25) {
            embed.setFooter({ text: `Showing 25 of ${blockedUsers.length} blocked users` });
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'unblock': {
          const userInput = interaction.options.getString('user', true);
          
          // Try both direct match and IRC prefixed match
          let success = bot.rateLimiter.unblockUser(userInput);
          if (!success && !userInput.startsWith('irc:')) {
            success = bot.rateLimiter.unblockUser(`irc:${userInput}`);
          }

          if (success) {
            await interaction.reply({ 
              content: `✅ Successfully unblocked user: ${userInput}`, 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `❌ User not found or not currently blocked: ${userInput}`, 
              ephemeral: true 
            });
          }
          break;
        }

        case 'clear': {
          const userInput = interaction.options.getString('user', true);
          
          // Try both direct match and IRC prefixed match
          let success = bot.rateLimiter.clearWarnings(userInput);
          if (!success && !userInput.startsWith('irc:')) {
            success = bot.rateLimiter.clearWarnings(`irc:${userInput}`);
          }

          if (success) {
            await interaction.reply({ 
              content: `✅ Successfully cleared warnings for user: ${userInput}`, 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `❌ User not found: ${userInput}`, 
              ephemeral: true 
            });
          }
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in rate limit command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute rate limit command.', 
        ephemeral: true 
      });
    }
  }
};

// Metrics monitoring command
export const metricsCommand: SlashCommand = {
  data: {
    name: 'irc-metrics',
    description: 'View detailed IRC bridge metrics and statistics',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'summary',
        description: 'Show metrics summary'
      },
      {
        type: 'SUB_COMMAND',
        name: 'detailed',
        description: 'Show detailed metrics breakdown'
      },
      {
        type: 'SUB_COMMAND',
        name: 'recent',
        description: 'Show recent activity (last hour)'
      },
      {
        type: 'SUB_COMMAND',
        name: 'export',
        description: 'Export metrics in Prometheus format'
      },
      {
        type: 'SUB_COMMAND',
        name: 'reset',
        description: 'Reset all metrics (admin only)'
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'summary': {
          const summary = bot.metrics.getSummary();
          const embed = new MessageEmbed()
            .setTitle('📊 IRC Bridge Metrics Summary')
            .setColor('#3498db')
            .addField('📨 Total Messages', `${summary.totalMessages}`, true)
            .addField('⏱️ Messages/Hour', `${summary.messagesPerHour.toFixed(1)}`, true)
            .addField('👥 Unique Users', `${summary.uniqueUsers}`, true)
            .addField('❌ Error Rate', `${summary.errorRate.toFixed(2)}%`, true)
            .addField('🚀 Avg Latency', `${summary.averageLatency.toFixed(0)}ms`, true)
            .addField('⏰ Uptime', `${Math.floor(summary.uptime / (1000 * 60 * 60))}h`, true)
            .setTimestamp();

          if (summary.topChannels.length > 0) {
            const channelList = summary.topChannels.slice(0, 5)
              .map(ch => `**${ch.channel}**: ${ch.messages}`)
              .join('\n');
            embed.addField('🔥 Top Channels', channelList, true);
          }

          if (summary.topUsers.length > 0) {
            const userList = summary.topUsers.slice(0, 5)
              .map(u => {
                const displayName = u.user.startsWith('irc:') ? u.user.slice(4) + ' (IRC)' : u.user + ' (Discord)';
                return `**${displayName}**: ${u.messages}`;
              })
              .join('\n');
            embed.addField('👑 Top Users', userList, true);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'detailed': {
          const detailed = bot.metrics.getDetailedMetrics();
          const embed = new MessageEmbed()
            .setTitle('📈 Detailed IRC Bridge Metrics')
            .setColor('#9b59b6')
            .addField('Discord → IRC', `${detailed.messagesDiscordToIRC}`, true)
            .addField('IRC → Discord', `${detailed.messagesIRCToDiscord}`, true)
            .addField('Commands Processed', `${detailed.commandsProcessed}`, true)
            .addField('Attachments Sent', `${detailed.attachmentsSent}`, true)
            .addField('Edits Processed', `${detailed.editsProcessed}`, true)
            .addField('Deletes Processed', `${detailed.deletesProcessed}`, true)
            .addField('Messages Blocked', `${detailed.messagesBlocked}`, true)
            .addField('Users Warned', `${detailed.usersWarned}`, true)
            .addField('Users Blocked', `${detailed.usersBlocked}`, true)
            .addField('Spam Detected', `${detailed.spamDetected}`, true)
            .addField('Connection Errors', `${detailed.connectionErrors}`, true)
            .addField('Webhook Errors', `${detailed.webhookErrors}`, true)
            .addField('PM Threads Created', `${detailed.pmThreadsCreated}`, true)
            .addField('PM Messages', `${detailed.pmMessagesExchanged}`, true)
            .addField('Peak Concurrent Users', `${detailed.peakConcurrentUsers}`, true)
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'recent': {
          const recent = bot.metrics.getRecentActivity();
          const embed = new MessageEmbed()
            .setTitle('🕐 Recent Activity (Last Hour)')
            .setColor('#e67e22')
            .addField('Messages', `${recent.messagesLastHour}`, true)
            .addField('Errors', `${recent.errorsLastHour}`, true)
            .addField('Avg Latency', `${recent.averageLatencyLastHour.toFixed(0)}ms`, true)
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'export': {
          const prometheusMetrics = bot.metrics.exportPrometheusMetrics();
          
          // Send as a file attachment since it can be long
          const buffer = Buffer.from(prometheusMetrics, 'utf8');
          const attachment = new MessageAttachment(buffer, `irc-bridge-metrics-${Date.now()}.txt`);
          
          await interaction.reply({ 
            content: '📤 **Prometheus Metrics Export**\n\nMetrics exported in Prometheus format. You can use these with monitoring systems like Grafana.',
            files: [attachment], 
            ephemeral: true 
          });
          break;
        }

        case 'reset': {
          bot.metrics.resetMetrics();
          await interaction.reply({ 
            content: '🔄 **Metrics Reset**\n\nAll metrics have been reset to zero. This action has been logged.',
            ephemeral: true 
          });
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in metrics command:', error);
      await interaction.reply({ 
        content: '❌ Failed to retrieve metrics information.', 
        ephemeral: true 
      });
    }
  }
};

// Recovery management command
export const recoveryCommand: SlashCommand = {
  data: {
    name: 'irc-recovery',
    description: 'Manage IRC bridge error recovery and connection health',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'status',
        description: 'Show connection health and recovery status'
      },
      {
        type: 'SUB_COMMAND',
        name: 'force',
        description: 'Force manual recovery attempt',
        options: [
          {
            type: 'STRING',
            name: 'service',
            description: 'Service to recover (discord or irc)',
            required: true,
            choices: [
              { name: 'Discord', value: 'discord' },
              { name: 'IRC', value: 'irc' }
            ]
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'reset',
        description: 'Reset circuit breaker for a service',
        options: [
          {
            type: 'STRING',
            name: 'service',
            description: 'Service to reset (discord or irc)',
            required: true,
            choices: [
              { name: 'Discord', value: 'discord' },
              { name: 'IRC', value: 'irc' }
            ]
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'history',
        description: 'Show recent recovery attempts'
      },
      {
        type: 'SUB_COMMAND',
        name: 'clear',
        description: 'Clear recovery history'
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'status': {
          const health = bot.recoveryManager.getHealthStatus();
          const stats = bot.recoveryManager.getStatistics();
          
          const embed = new MessageEmbed()
            .setTitle('🏥 Connection Health & Recovery Status')
            .setColor(health.discord.isHealthy && health.irc.isHealthy ? '#00ff00' : '#ff9900')
            .setTimestamp();

          // Discord status
          const discordStatus = health.discord.isHealthy ? '✅ Healthy' : '❌ Unhealthy';
          const discordInfo = [
            `Status: ${discordStatus}`,
            `Failures: ${health.discord.consecutiveFailures}/${health.discord.totalFailures}`,
            `Last Success: <t:${Math.floor(health.discord.lastSuccessful / 1000)}:R>`
          ].join('\n');
          embed.addField('🟦 Discord', discordInfo, true);

          // IRC status  
          const ircStatus = health.irc.isHealthy ? '✅ Healthy' : '❌ Unhealthy';
          const ircInfo = [
            `Status: ${ircStatus}`,
            `Failures: ${health.irc.consecutiveFailures}/${health.irc.totalFailures}`,
            `Last Success: <t:${Math.floor(health.irc.lastSuccessful / 1000)}:R>`
          ].join('\n');
          embed.addField('⚫ IRC', ircInfo, true);

          // Recovery stats
          const recoveryInfo = [
            `Total Attempts: ${stats.totalRecoveryAttempts}`,
            `Successful: ${stats.successfulRecoveries}`,
            `Failed: ${stats.failedRecoveries}`,
            `Avg Time: ${stats.averageRecoveryTime.toFixed(0)}ms`
          ].join('\n');
          embed.addField('🔄 Recovery Stats', recoveryInfo, true);

          // Circuit breakers
          const breakerCount = Object.keys(health.circuitBreakers).length;
          const breakerStatus = breakerCount > 0 
            ? `🚫 ${breakerCount} active` 
            : '✅ All clear';
          embed.addField('⚡ Circuit Breakers', breakerStatus, true);

          // Recovery status
          const recoveryStatus = health.isRecovering ? '🔄 In Progress' : '⏸️ Idle';
          embed.addField('🔧 Recovery Process', recoveryStatus, true);

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'force': {
          const service = interaction.options.getString('service', true) as 'discord' | 'irc';
          
          try {
            await interaction.deferReply({ ephemeral: true });
            
            await bot.recoveryManager.forceRecovery(service);
            
            await interaction.editReply({ 
              content: `✅ **Manual Recovery Successful**\n\nSuccessfully forced recovery for ${service}.` 
            });
          } catch (error) {
            await interaction.editReply({ 
              content: `❌ **Manual Recovery Failed**\n\nFailed to force recovery for ${service}: ${(error as Error).message}` 
            });
          }
          break;
        }

        case 'reset': {
          const service = interaction.options.getString('service', true) as 'discord' | 'irc';
          
          bot.recoveryManager.resetCircuitBreaker(service);
          
          await interaction.reply({ 
            content: `🔓 **Circuit Breaker Reset**\n\nCircuit breaker for ${service} has been manually reset.`,
            ephemeral: true 
          });
          break;
        }

        case 'history': {
          const health = bot.recoveryManager.getHealthStatus();
          
          if (health.recoveryHistory.length === 0) {
            await interaction.reply({ 
              content: '📝 **Recovery History**\n\nNo recent recovery attempts found.',
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle('📝 Recent Recovery Attempts')
            .setColor('#3498db')
            .setTimestamp();

          const historyList = health.recoveryHistory.slice(-10).map(attempt => {
            const status = attempt.success ? '✅' : '❌';
            const timestamp = `<t:${Math.floor(attempt.timestamp / 1000)}:t>`;
            const delay = `${attempt.delay}ms`;
            return `${status} Attempt #${attempt.attempt} at ${timestamp} (${delay} delay)`;
          }).join('\n');

          embed.setDescription(historyList);
          
          if (health.recoveryHistory.length > 10) {
            embed.setFooter({ text: `Showing last 10 of ${health.recoveryHistory.length} attempts` });
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'clear': {
          bot.recoveryManager.clearHistory();
          
          await interaction.reply({ 
            content: '🗑️ **Recovery History Cleared**\n\nAll recovery history has been cleared.',
            ephemeral: true 
          });
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in recovery command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute recovery command.', 
        ephemeral: true 
      });
    }
  }
};

// S3 Config command handlers
async function handleS3ConfigCommands(interaction: CommandInteraction, bot: Bot, subcommand: string): Promise<void> {
  const guildId = interaction.guildId!;

  switch (subcommand) {
    case 'set': {
      await interaction.deferReply({ ephemeral: true });

      // Get or generate encryption key
      let encryptionKey: string;
      let keyWasGenerated = false;

      const providedKey = interaction.options.getString('encryption_key');
      if (!providedKey) {
        // Check if we already have one in env or generate new one
        const envKey = process.env.S3_CONFIG_ENCRYPTION_KEY;
        if (envKey) {
          encryptionKey = envKey;
        } else {
          // Generate a new encryption key
          encryptionKey = require('crypto').randomBytes(32).toString('hex');
          keyWasGenerated = true;
          // Set it in the current process environment for this session
          process.env.S3_CONFIG_ENCRYPTION_KEY = encryptionKey;
        }
      } else {
        // User provided a key - validate it
        if (providedKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(providedKey)) {
          await interaction.editReply({
            content: '❌ **Invalid Encryption Key**\n\nKey must be 64 hexadecimal characters.\nGenerate: `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`'
          });
          return;
        }
        encryptionKey = providedKey;
        // Set the provided key as the active one
        process.env.S3_CONFIG_ENCRYPTION_KEY = encryptionKey;
      }

      const bucket = interaction.options.getString('bucket', true);
      const region = interaction.options.getString('region', true);
      const accessKeyId = interaction.options.getString('access_key_id', true);
      const secretAccessKey = interaction.options.getString('secret_access_key', true);
      const endpoint = interaction.options.getString('endpoint') || undefined;
      const keyPrefix = interaction.options.getString('key_prefix') || undefined;
      const maxFileSizeMb = interaction.options.getInteger('max_file_size_mb') || 25;
      const defaultFolder = interaction.options.getString('default_folder') || undefined;
      const autoShareToIRC = interaction.options.getBoolean('auto_share_to_irc') ?? false;
      const urlShortenerPrefix = interaction.options.getString('url_shortener_prefix') || undefined;

      if (maxFileSizeMb < 1 || maxFileSizeMb > 100) {
        await interaction.editReply({ content: '❌ Max file size must be 1-100 MB.' });
        return;
      }

      try {
        const s3Config: S3Config = { guildId, bucket, region, endpoint, accessKeyId, secretAccessKey, keyPrefix, publicUrlBase: undefined, forcePathStyle: !!endpoint, maxFileSizeMb, allowedRoles: undefined, defaultFolder, autoShareToIRC, urlShortenerPrefix, createdAt: Date.now(), updatedAt: Date.now() };
        if (!bot.persistence) throw new Error('Database not available');
        await bot.persistence.saveS3Config(s3Config);

        // Save encryption key to database for persistence across restarts
        await bot.persistence.saveEncryptionKey(encryptionKey);

        const testUploader = new S3Uploader({ region, bucket, accessKeyId, secretAccessKey, endpoint, keyPrefix, forcePathStyle: s3Config.forcePathStyle });
        const testResult = await testUploader.testConnection();

        // Build response message
        let responseMessage = '';
        if (testResult.success) {
          responseMessage = `✅ **S3 Configured**\n\nBucket: \`${bucket}\`\nRegion: \`${region}\`\nTest: ✅`;
        } else {
          responseMessage = `⚠️ **S3 Saved (Test Failed)**\n\nBucket: \`${bucket}\`\nTest: ❌ ${testResult.error}\n\nVerify credentials.`;
        }

        // Add encryption key information if it was generated
        if (keyWasGenerated) {
          responseMessage += '\n\n🔐 **Auto-Generated Encryption Key**\n';
          responseMessage += '✅ Key automatically saved to database\n';
          responseMessage += '✅ Will persist across bot restarts\n';
          responseMessage += '\n💡 **Optional:** Export for external backups:\n';
          responseMessage += '```\n' + encryptionKey + '\n```';
        }

        if (testResult.success) {
          responseMessage += '\n\nUse `/s3 files upload` to upload files.';
        }

        await interaction.editReply({ content: responseMessage });
      } catch (error) {
        await interaction.editReply({ content: `❌ Save failed: ${(error as Error).message}` });
      }
      break;
    }

    case 'view': {
      await interaction.deferReply({ ephemeral: true });
      if (!bot.persistence) { await interaction.editReply({ content: '❌ Database not available.' }); return; }
      const config = await bot.persistence.getS3Config(guildId);
      if (!config) { await interaction.editReply({ content: '❌ **Not Configured**\n\nUse `/s3 config set`.' }); return; }

      const embed = new MessageEmbed().setTitle('🔧 S3 Configuration').setColor('#3498db')
        .addField('Bucket', config.bucket, true).addField('Region', config.region, true).addField('Max Size', `${config.maxFileSizeMb} MB`, true).setTimestamp();
      if (config.endpoint) embed.addField('Endpoint', config.endpoint, false);
      if (config.keyPrefix) embed.addField('Prefix', config.keyPrefix, true);
      embed.addField('Access Key', `${config.accessKeyId.substring(0, 8)}...`, true).addField('Secret', '••••••••', true);
      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'test': {
      await interaction.deferReply({ ephemeral: true });
      if (!bot.persistence) { await interaction.editReply({ content: '❌ Database not available.' }); return; }
      const config = await bot.persistence.getS3Config(guildId);
      if (!config) { await interaction.editReply({ content: '❌ Use `/s3 config set` first.' }); return; }

      const uploader = new S3Uploader({ region: config.region, bucket: config.bucket, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, endpoint: config.endpoint, keyPrefix: config.keyPrefix, forcePathStyle: config.forcePathStyle });
      const result = await uploader.testConnection();
      await interaction.editReply({ content: result.success ? '✅ **Test Successful**' : `❌ **Test Failed**\n\n${result.error}` });
      break;
    }

    case 'remove': {
      await interaction.deferReply({ ephemeral: true });
      if (!bot.persistence) { await interaction.editReply({ content: '❌ Database not available.' }); return; }
      await bot.persistence.deleteS3Config(guildId);
      await interaction.editReply({ content: '✅ **S3 Configuration Removed**' });
      break;
    }
  }
}

// S3 Files command handlers
async function handleS3FilesCommands(interaction: CommandInteraction, bot: Bot, subcommand: string): Promise<void> {
  const guildId = interaction.guildId!;
  if (!bot.persistence) { await interaction.reply({ content: '❌ Database not available.', ephemeral: true }); return; }
  const config = await bot.persistence.getS3Config(guildId);
  if (!config) { await interaction.reply({ content: '❌ **Not Configured**\n\nUse `/s3 config set` first.', ephemeral: true }); return; }

  const uploader = new S3Uploader({ region: config.region, bucket: config.bucket, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, endpoint: config.endpoint, keyPrefix: config.keyPrefix, publicUrlBase: config.publicUrlBase, forcePathStyle: config.forcePathStyle });

  switch (subcommand) {
    case 'upload': {
      await interaction.deferReply({ ephemeral: true });

      // Check rate limit
      const rateLimit = s3RateLimiter.checkLimit(interaction.user.id);
      if (!rateLimit.allowed) {
        await interaction.editReply({
          content: `⏱️ **Rate Limit Exceeded**\n\nPlease wait ${rateLimit.retryAfter} seconds before uploading again.\n\nLimit: 5 uploads per 10 minutes`
        });
        return;
      }

      const attachment = interaction.options.getAttachment('file', true);
      const folder = interaction.options.getString('folder') || config.defaultFolder || undefined;
      const customName = interaction.options.getString('name') || undefined;

      if (attachment.size > config.maxFileSizeMb * 1024 * 1024) {
        await interaction.editReply({ content: `❌ **Too Large**\n\nSize: ${(attachment.size / 1024 / 1024).toFixed(2)} MB\nMax: ${config.maxFileSizeMb} MB` });
        return;
      }

      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const filename = customName || attachment.name || 'file';
        const customFilename = folder ? `${folder}/${filename}` : filename;

        // Check if file already exists and auto-rename if needed
        let finalFilename = customFilename;
        try {
          await uploader.getObjectMetadata(customFilename);
          // File exists - auto-rename with timestamp
          const timestamp = Date.now();
          const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
          const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
          const renamedFile = `${baseName}_${timestamp}${ext}`;
          finalFilename = folder ? `${folder}/${renamedFile}` : renamedFile;

          await interaction.editReply({
            content: `⚠️ **File Renamed**\n\nOriginal: \`${customFilename}\`\nRenamed to: \`${finalFilename}\`\n\nUploading...`
          });
        } catch {
          // File doesn't exist, continue with original name
        }

        const result = await uploader.uploadFile(interaction.user.id, buffer, filename, finalFilename || undefined);

        if (result.success) {
          const embed = new MessageEmbed().setTitle('✅ Upload Success').setColor('#00ff00')
            .addField('File', filename, true).addField('Size', `${(attachment.size / 1024).toFixed(2)} KB`, true)
            .addField('Key', result.key!, false).addField('URL', result.url!, false).setTimestamp();
          await interaction.editReply({ embeds: [embed] });

          // Auto-share to IRC if enabled
          if (config.autoShareToIRC && result.url && interaction.channel) {
            const sharedToIRC = shareToIRC(
              bot,
              interaction.channel.id,
              interaction.user.username,
              finalFilename,
              result.url,
              config.urlShortenerPrefix
            );
            if (sharedToIRC) {
              logger.debug(`Auto-shared upload to IRC: ${finalFilename}`);
            }
          }
        } else {
          await interaction.editReply({ content: `❌ Upload failed: ${result.error}` });
        }
      } catch (error) {
        await interaction.editReply({ content: `❌ Error: ${(error as Error).message}` });
      }
      break;
    }

    case 'list': {
      await interaction.deferReply({ ephemeral: true });
      const prefix = interaction.options.getString('prefix') || undefined;

      try {
        const result = await uploader.listObjects(prefix);
        if (result.objects.length === 0) {
          await interaction.editReply({ content: '📁 **No files found**' });
          return;
        }

        const embed = new MessageEmbed().setTitle(`📁 Files in ${config.bucket}`).setColor('#3498db').setTimestamp();
        if (prefix) embed.setDescription(`Prefix: \`${prefix}\``);

        const fileList = result.objects.map(obj => {
          const sizeKB = (obj.size / 1024).toFixed(2);
          const date = obj.lastModified.toISOString().split('T')[0];
          return `\`${obj.key}\` - ${sizeKB} KB - ${date}`;
        }).join('\n');

        embed.addField(`Files (${result.objects.length})`, fileList.substring(0, 1024), false);

        // Add pagination buttons if there are more results
        const components: MessageActionRow[] = [];
        if (result.isTruncated && result.nextContinuationToken) {
          const row = new MessageActionRow().addComponents(
            new MessageButton()
              .setCustomId(`s3_list_next_${result.nextContinuationToken}_${prefix || 'null'}`)
              .setLabel('Next →')
              .setStyle('PRIMARY')
          );
          components.push(row);
          embed.setFooter({ text: 'Page 1 - More files available' });
        }

        await interaction.editReply({
          embeds: [embed],
          components
        });
      } catch (error) {
        await interaction.editReply({ content: `❌ List failed: ${(error as Error).message}` });
      }
      break;
    }

    case 'info': {
      await interaction.deferReply({ ephemeral: true });
      const key = interaction.options.getString('key', true);

      try {
        const metadata = await uploader.getObjectMetadata(key);
        const url = await uploader.getObjectUrl(key);

        const embed = new MessageEmbed()
          .setTitle('📄 File Information')
          .setColor('#3498db')
          .addField('Key', key, false)
          .addField('Size', `${(metadata.contentLength / 1024).toFixed(2)} KB (${metadata.contentLength.toLocaleString()} bytes)`, true)
          .addField('Type', metadata.contentType || 'Unknown', true)
          .addField('Modified', metadata.lastModified.toLocaleString(), false)
          .addField('ETag', metadata.etag, false)
          .addField('URL', url, false)
          .setTimestamp();

        // Add custom metadata if present
        if (Object.keys(metadata.metadata).length > 0) {
          const metadataStr = Object.entries(metadata.metadata)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');
          embed.addField('Custom Metadata', metadataStr, false);
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        await interaction.editReply({ content: `❌ Failed to get file info: ${(error as Error).message}` });
      }
      break;
    }

    case 'rename': {
      await interaction.deferReply({ ephemeral: true });
      const oldKey = interaction.options.getString('old_key', true);
      const newKey = interaction.options.getString('new_key', true);

      try {
        await uploader.renameObject(oldKey, newKey);
        const newUrl = await uploader.getObjectUrl(newKey);

        const embed = new MessageEmbed()
          .setTitle('✅ File Renamed')
          .setColor('#00ff00')
          .addField('Old Key', oldKey, false)
          .addField('New Key', newKey, false)
          .addField('New URL', newUrl, false)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        await interaction.editReply({ content: `❌ Rename failed: ${(error as Error).message}` });
      }
      break;
    }

    case 'delete': {
      await interaction.deferReply({ ephemeral: true });
      const key = interaction.options.getString('key', true);

      try {
        // Show confirmation warning
        const embed = new MessageEmbed()
          .setTitle('⚠️  Confirm Deletion')
          .setColor('#ff0000')
          .setDescription(`Are you sure you want to delete this file? **This action cannot be undone.**`)
          .addField('File', key, false)
          .addField('Bucket', config.bucket, true)
          .setFooter({ text: 'Use the buttons below to confirm or cancel' });

        const confirmButton = new MessageButton()
          .setCustomId(`s3_delete_confirm_${key}`)
          .setLabel('Delete File')
          .setStyle('DANGER');

        const cancelButton = new MessageButton()
          .setCustomId('s3_delete_cancel')
          .setLabel('Cancel')
          .setStyle('SECONDARY');

        const row = new MessageActionRow().addComponents(confirmButton, cancelButton);

        await interaction.editReply({ embeds: [embed], components: [row] });

        // Set up button collector
        const reply = await interaction.fetchReply();
        // Type guard: fetchReply returns Message when not ephemeral
        if (!('createMessageComponentCollector' in reply)) {
          await interaction.editReply({ content: '❌ Unable to create confirmation collector.', components: [] });
          return;
        }
        const collector = reply.createMessageComponentCollector({
          time: 60000, // 60 seconds
          filter: (i) => i.user.id === interaction.user.id
        });

        collector.on('collect', async (buttonInteraction) => {
          await buttonInteraction.deferUpdate();

          if (buttonInteraction.customId === 's3_delete_cancel') {
            const cancelEmbed = new MessageEmbed()
              .setTitle('❌ Deletion Cancelled')
              .setColor('#808080')
              .setDescription('The file was not deleted.')
              .setTimestamp();
            await interaction.editReply({ embeds: [cancelEmbed], components: [] });
            collector.stop();
          } else if (buttonInteraction.customId.startsWith('s3_delete_confirm_')) {
            try {
              await uploader.deleteObject(key);
              const successEmbed = new MessageEmbed()
                .setTitle('✅ File Deleted')
                .setColor('#00ff00')
                .addField('Deleted', key, false)
                .addField('Bucket', config.bucket, true)
                .setTimestamp();
              await interaction.editReply({ embeds: [successEmbed], components: [] });
            } catch (deleteError) {
              const errorEmbed = new MessageEmbed()
                .setTitle('❌ Deletion Failed')
                .setColor('#ff0000')
                .setDescription((deleteError as Error).message)
                .setTimestamp();
              await interaction.editReply({ embeds: [errorEmbed], components: [] });
            }
            collector.stop();
          }
        });

        collector.on('end', (collected, reason) => {
          if (reason === 'time') {
            const timeoutEmbed = new MessageEmbed()
              .setTitle('⏱️ Confirmation Timeout')
              .setColor('#808080')
              .setDescription('Deletion confirmation expired. The file was not deleted.')
              .setTimestamp();
            interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
          }
        });
      } catch (error) {
        await interaction.editReply({ content: `❌ Error: ${(error as Error).message}` });
      }
      break;
    }
  }
}

// S3 Status command handler
async function handleS3StatusCommand(interaction: CommandInteraction, bot: Bot): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const embed = new MessageEmbed().setTitle('📊 S3 Storage Status').setColor('#3498db').setTimestamp();

  if (!bot.persistence) {
    embed.setDescription('❌ Database not available.');
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const config = await bot.persistence.getS3Config(interaction.guildId!);
  if (config) {
    embed.setColor('#00ff00').addField('Status', '✅ Configured', true).addField('Bucket', config.bucket, true)
      .addField('Region', config.region, true).addField('Max Size', `${config.maxFileSizeMb} MB`, true);
    if (config.keyPrefix) embed.addField('Prefix', config.keyPrefix, true);
    embed.setDescription('Use `/s3 files upload` to upload, `/s3 files list` to view files.');
  } else {
    embed.setColor('#ff9900').addField('Status', '❌ Not Configured', true)
      .setDescription('Use `/s3 config set` to configure S3 storage.');
  }
  await interaction.editReply({ embeds: [embed] });
}

// S3 Share command handler - Upload and share in one action
async function handleS3ShareCommand(interaction: CommandInteraction, bot: Bot): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const guildId = interaction.guildId!;

  if (!bot.persistence) {
    await interaction.editReply({ content: '❌ Database not available.' });
    return;
  }

  const config = await bot.persistence.getS3Config(guildId);
  if (!config) {
    await interaction.editReply({ content: '❌ **Not Configured**\n\nUse `/s3 config set` first.' });
    return;
  }

  // Check rate limit
  const rateLimit = s3RateLimiter.checkLimit(interaction.user.id);
  if (!rateLimit.allowed) {
    await interaction.editReply({
      content: `⏱️ **Rate Limit Exceeded**\n\nPlease wait ${rateLimit.retryAfter} seconds before sharing again.\n\nLimit: 5 uploads per 10 minutes`
    });
    return;
  }

  const attachment = interaction.options.getAttachment('file', true);
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const userMessage = interaction.options.getString('message') || undefined;
  const folder = interaction.options.getString('folder') || config.defaultFolder || undefined;
  const customName = interaction.options.getString('name') || undefined;

  // Validate file size
  if (attachment.size > config.maxFileSizeMb * 1024 * 1024) {
    await interaction.editReply({
      content: `❌ **File Too Large**\n\nSize: ${(attachment.size / 1024 / 1024).toFixed(2)} MB\nMax: ${config.maxFileSizeMb} MB`
    });
    return;
  }

  // Validate target channel is a text channel
  if (!targetChannel || !('send' in targetChannel)) {
    await interaction.editReply({ content: '❌ Invalid target channel. Must be a text channel.' });
    return;
  }

  try {
    // Upload to S3
    const uploader = new S3Uploader({
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      endpoint: config.endpoint,
      keyPrefix: config.keyPrefix,
      publicUrlBase: config.publicUrlBase,
      forcePathStyle: config.forcePathStyle
    });

    const response = await fetch(attachment.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = customName || attachment.name || 'file';
    const customFilename = folder ? `${folder}/${filename}` : filename;

    // Check if file already exists and auto-rename if needed
    let finalFilename = customFilename;
    try {
      await uploader.getObjectMetadata(customFilename);
      // File exists - auto-rename with timestamp
      const timestamp = Date.now();
      const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
      const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
      const renamedFile = `${baseName}_${timestamp}${ext}`;
      finalFilename = folder ? `${folder}/${renamedFile}` : renamedFile;

      await interaction.editReply({
        content: `⚠️ **File Renamed**\n\nOriginal: \`${customFilename}\`\nRenamed to: \`${finalFilename}\`\n\nUploading and sharing...`
      });
    } catch {
      // File doesn't exist, continue with original name
    }

    const result = await uploader.uploadFile(interaction.user.id, buffer, filename, finalFilename || undefined);

    if (!result.success) {
      await interaction.editReply({ content: `❌ Upload failed: ${result.error}` });
      return;
    }

    // Share to IRC instead of Discord
    const sharedToIRC = shareToIRC(
      bot,
      targetChannel.id,
      interaction.user.username,
      finalFilename,
      result.url!,
      config.urlShortenerPrefix
    );

    if (sharedToIRC) {
      // Update ephemeral reply
      await interaction.editReply({
        content: `✅ **File Shared to IRC**\n\nChannel: <#${targetChannel.id}>\nFilename: ${filename}\nURL: ${result.url}`
      });
    } else {
      await interaction.editReply({
        content: `⚠️ **File Uploaded but Not Shared**\n\nNo IRC channel mapping found for <#${targetChannel.id}>.\n\nURL: ${result.url}`
      });
    }
  } catch (error) {
    logger.error('S3 share command error:', error);
    await interaction.editReply({ content: `❌ Share failed: ${(error as Error).message}` });
  }
}

// S3 management command
export const s3Command: SlashCommand = {
  data: {
    name: 's3',
    description: 'Manage S3 file storage and uploads',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      { type: 'SUB_COMMAND_GROUP', name: 'config', description: 'Manage S3 configuration', options: [
        { type: 'SUB_COMMAND', name: 'set', description: 'Configure S3 credentials', options: [
          { type: 'STRING', name: 'bucket', description: 'S3 bucket name', required: true },
          { type: 'STRING', name: 'region', description: 'AWS region (e.g., us-east-1)', required: true },
          { type: 'STRING', name: 'access_key_id', description: 'AWS Access Key ID', required: true },
          { type: 'STRING', name: 'secret_access_key', description: 'AWS Secret (encrypted)', required: true },
          { type: 'STRING', name: 'endpoint', description: 'S3-compatible endpoint', required: false },
          { type: 'STRING', name: 'key_prefix', description: 'Folder prefix', required: false },
          { type: 'INTEGER', name: 'max_file_size_mb', description: 'Max MB (1-100, default: 25)', required: false },
          { type: 'STRING', name: 'encryption_key', description: 'Encryption key (auto-generated if omitted)', required: false },
          { type: 'STRING', name: 'default_folder', description: 'Default subfolder for uploads', required: false },
          { type: 'BOOLEAN', name: 'auto_share_to_irc', description: 'Auto-share uploads to IRC (default: false)', required: false },
          { type: 'STRING', name: 'url_shortener_prefix', description: 'URL shortener prefix (e.g., https://short.link/)', required: false }
        ]},
        { type: 'SUB_COMMAND', name: 'view', description: 'View configuration' },
        { type: 'SUB_COMMAND', name: 'test', description: 'Test connection' },
        { type: 'SUB_COMMAND', name: 'remove', description: 'Delete configuration' }
      ]},
      { type: 'SUB_COMMAND_GROUP', name: 'files', description: 'File operations', options: [
        { type: 'SUB_COMMAND', name: 'upload', description: 'Upload file to S3', options: [
          { type: 'ATTACHMENT', name: 'file', description: 'File to upload', required: true },
          { type: 'STRING', name: 'folder', description: 'Optional folder', required: false },
          { type: 'STRING', name: 'name', description: 'Custom filename (default: original name)', required: false }
        ]},
        { type: 'SUB_COMMAND', name: 'list', description: 'List files', options: [
          { type: 'STRING', name: 'prefix', description: 'Filter by prefix', required: false }
        ]},
        { type: 'SUB_COMMAND', name: 'info', description: 'Get file information', options: [
          { type: 'STRING', name: 'key', description: 'File key/path in S3', required: true }
        ]},
        { type: 'SUB_COMMAND', name: 'rename', description: 'Rename a file', options: [
          { type: 'STRING', name: 'old_key', description: 'Current file key/path', required: true },
          { type: 'STRING', name: 'new_key', description: 'New file key/path', required: true }
        ]},
        { type: 'SUB_COMMAND', name: 'delete', description: 'Delete a file', options: [
          { type: 'STRING', name: 'key', description: 'File key/path to delete', required: true }
        ]}
      ]},
      { type: 'SUB_COMMAND', name: 'share', description: 'Upload and share file in channel', options: [
        { type: 'ATTACHMENT', name: 'file', description: 'File to upload and share', required: true },
        { type: 'CHANNEL', name: 'channel', description: 'Target channel (default: current)', required: false },
        { type: 'STRING', name: 'message', description: 'Optional message/caption', required: false },
        { type: 'STRING', name: 'folder', description: 'Optional S3 folder', required: false },
        { type: 'STRING', name: 'name', description: 'Custom filename (default: original name)', required: false }
      ]},
      { type: 'SUB_COMMAND', name: 'status', description: 'Show status' }
    ]
  },

  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ content: '❌ Administrator permissions required.', ephemeral: true });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ content: '❌ Server-only command.', ephemeral: true });
      return;
    }

    try {
      const subcommandGroup = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      if (subcommandGroup === 'config') await handleS3ConfigCommands(interaction, bot, subcommand);
      else if (subcommandGroup === 'files') await handleS3FilesCommands(interaction, bot, subcommand);
      else if (subcommand === 'share') await handleS3ShareCommand(interaction, bot);
      else if (subcommand === 'status') await handleS3StatusCommand(interaction, bot);
    } catch (error) {
      logger.error('S3 command error:', error);
      try {
        const method = interaction.deferred || interaction.replied ? 'editReply' : 'reply';
        await interaction[method]({ content: `❌ Error: ${(error as Error).message}`, ephemeral: true });
      } catch (replyError) {
        logger.error('Failed to send error:', replyError);
      }
    }
  }
};

// Mention management command
export const mentionCommand: SlashCommand = {
  data: {
    name: 'irc-mentions',
    description: 'Manage IRC-to-Discord mention notifications',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'status',
        description: 'Show mention detection configuration and status'
      },
      {
        type: 'SUB_COMMAND',
        name: 'test',
        description: 'Test mention detection for a specific username and message',
        options: [
          {
            type: 'STRING',
            name: 'username',
            description: 'Discord username to test',
            required: true
          },
          {
            type: 'STRING',
            name: 'message',
            description: 'IRC message text to test',
            required: true
          },
          {
            type: 'STRING',
            name: 'irc_author',
            description: 'IRC author username (for anti-self-ping test)',
            required: false
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'enable',
        description: 'Enable mention detection'
      },
      {
        type: 'SUB_COMMAND',
        name: 'disable',
        description: 'Disable mention detection'
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'status': {
          const config = bot.mentionDetector.getConfig();
          
          const embed = new MessageEmbed()
            .setTitle('🔔 Mention Detection Configuration')
            .setColor(config.enabled ? '#00ff00' : '#ff9900')
            .setTimestamp();

          embed.addField('Status', config.enabled ? '✅ Enabled' : '❌ Disabled', true)
            .addField('Case Sensitive', config.caseSensitive ? 'Yes' : 'No', true)
            .addField('Word Boundary', config.requireWordBoundary ? 'Required' : 'Not Required', true)
            .addField('Partial Matches', config.allowPartialMatches ? 'Allowed' : 'Not Allowed', true)
            .addField('Max Username Length', `${config.maxLength} characters`, true)
            .addField('Excluded Prefixes', config.excludePrefixes.join(', ') || 'None', true)
            .addField('Excluded Suffixes', config.excludeSuffixes.join(', ') || 'None', true);

          if (config.enabled) {
            embed.setDescription('Mention detection is active. IRC usernames in messages will be converted to Discord mentions with anti-self-ping protection.');
          } else {
            embed.setDescription('Mention detection is disabled. Only @username#discriminator format will create mentions.');
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'test': {
          const username = interaction.options.getString('username', true);
          const message = interaction.options.getString('message', true);
          const ircAuthor = interaction.options.getString('irc_author') || 'testuser';
          
          const wouldMention = bot.mentionDetector.wouldMention(message, username, ircAuthor);
          
          const embed = new MessageEmbed()
            .setTitle('🧪 Mention Detection Test')
            .setColor(wouldMention ? '#00ff00' : '#ff9900')
            .addField('Username', username, true)
            .addField('IRC Author', ircAuthor, true)
            .addField('Message', `\`${message}\``, false)
            .addField('Result', wouldMention ? '✅ Would mention' : '❌ Would not mention', true)
            .setTimestamp();

          if (username.toLowerCase() === ircAuthor.toLowerCase()) {
            embed.addField('Anti-Self-Ping', '🛡️ Same user protection triggered', true);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'enable': {
          bot.mentionDetector.updateConfig({ enabled: true });
          await interaction.reply({ 
            content: '✅ **Mention Detection Enabled**\n\nIRC usernames in messages will now be converted to Discord mentions with anti-self-ping protection.',
            ephemeral: true 
          });
          break;
        }

        case 'disable': {
          bot.mentionDetector.updateConfig({ enabled: false });
          await interaction.reply({ 
            content: '❌ **Mention Detection Disabled**\n\nOnly @username#discriminator format will create mentions.',
            ephemeral: true 
          });
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in mention command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute mention command.', 
        ephemeral: true 
      });
    }
  }
};

// Status notifications management command
export const statusNotificationCommand: SlashCommand = {
  data: {
    name: 'irc-status-notifications',
    description: 'Manage IRC status notifications (join/leave/timeout)',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'status',
        description: 'Show status notification configuration'
      },
      {
        type: 'SUB_COMMAND',
        name: 'channels',
        description: 'Show configured notification channels for this server'
      },
      {
        type: 'SUB_COMMAND',
        name: 'enable',
        description: 'Enable status notifications'
      },
      {
        type: 'SUB_COMMAND',
        name: 'disable',
        description: 'Disable status notifications'
      },
      {
        type: 'SUB_COMMAND',
        name: 'test',
        description: 'Send a test notification',
        options: [
          {
            type: 'STRING',
            name: 'type',
            description: 'Type of notification to test',
            required: true,
            choices: [
              { name: 'Join', value: 'join' },
              { name: 'Leave', value: 'leave' },
              { name: 'Quit', value: 'quit' },
              { name: 'Kick', value: 'kick' },
              { name: 'Timeout', value: 'timeout' }
            ]
          }
        ]
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'status': {
          const config = bot.statusNotifications.getConfig();
          
          const embed = new MessageEmbed()
            .setTitle('📢 Status Notifications Configuration')
            .setColor(config.enabled ? '#00ff00' : '#ff9900')
            .setTimestamp();

          embed.addField('Status', config.enabled ? '✅ Enabled' : '❌ Disabled', true)
            .addField('Use Dedicated Channels', config.useDedicatedChannels ? 'Yes' : 'No', true)
            .addField('Fallback to Main', config.fallbackToMainChannel ? 'Yes' : 'No', true)
            .addField('Include Joins', config.includeJoins ? '✅' : '❌', true)
            .addField('Include Leaves', config.includeLeaves ? '✅' : '❌', true)
            .addField('Include Quits', config.includeQuits ? '✅' : '❌', true)
            .addField('Include Kicks', config.includeKicks ? '✅' : '❌', true)
            .addField('Include Timeouts', config.includeTimeouts ? '✅' : '❌', true)
            .addField('Include Bot Events', config.includeBotEvents ? '✅' : '❌', true);

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'channels': {
          if (!interaction.guild) {
            await interaction.reply({ 
              content: '❌ This command can only be used in a server.', 
              ephemeral: true 
            });
            return;
          }

          const channels = bot.statusNotifications.getChannels(interaction.guild.id);
          
          const embed = new MessageEmbed()
            .setTitle('📋 Status Notification Channels')
            .setColor('#3498db')
            .setTimestamp();

          if (channels?.joinLeave) {
            embed.addField('Join/Leave Channel', `<#${channels.joinLeave.id}>`, true);
          } else {
            embed.addField('Join/Leave Channel', 'Not configured', true);
          }

          if (channels?.timeout) {
            embed.addField('Timeout/Kick Channel', `<#${channels.timeout.id}>`, true);
          } else {
            embed.addField('Timeout/Kick Channel', 'Not configured', true);
          }

          if (!channels?.joinLeave && !channels?.timeout) {
            embed.setDescription('No dedicated channels configured. Notifications will use the main IRC bridge channels.');
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'enable': {
          bot.statusNotifications.updateConfig({ enabled: true });
          await interaction.reply({ 
            content: '✅ **Status Notifications Enabled**\n\nJoin/leave/quit notifications will now be sent to configured channels.',
            ephemeral: true 
          });
          break;
        }

        case 'disable': {
          bot.statusNotifications.updateConfig({ enabled: false });
          await interaction.reply({ 
            content: '❌ **Status Notifications Disabled**\n\nNo join/leave/quit notifications will be sent.',
            ephemeral: true 
          });
          break;
        }

        case 'test': {
          const notificationType = interaction.options.getString('type', true) as 'join' | 'leave' | 'quit' | 'kick' | 'timeout';
          const channel = interaction.channel;
          
          if (!channel || !channel.isText()) {
            await interaction.reply({ 
              content: '❌ This command must be used in a text channel.', 
              ephemeral: true 
            });
            return;
          }

          let sent = false;
          const testNick = 'TestUser';
          const testReason = 'Test notification';

          const textChannel = channel as TextChannel;
          
          switch (notificationType) {
            case 'join':
              sent = await bot.statusNotifications.sendJoinNotification(testNick, '#testchannel', textChannel);
              break;
            case 'leave':
              sent = await bot.statusNotifications.sendLeaveNotification(testNick, '#testchannel', testReason, textChannel);
              break;
            case 'quit':
              sent = await bot.statusNotifications.sendQuitNotification(testNick, testReason, textChannel);
              break;
            case 'kick':
              sent = await bot.statusNotifications.sendKickNotification(testNick, '#testchannel', testReason, textChannel);
              break;
            case 'timeout':
              sent = await bot.statusNotifications.sendTimeoutNotification(testNick, '#testchannel', testReason, textChannel);
              break;
          }

          if (sent) {
            await interaction.reply({ 
              content: `✅ **Test Notification Sent**\n\nSent a test ${notificationType} notification.`,
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `❌ **Test Notification Failed**\n\nFailed to send ${notificationType} notification. Check that notifications are enabled for this type.`,
              ephemeral: true 
            });
          }
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in status notification command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute status notification command.', 
        ephemeral: true 
      });
    }
  }
};

// IRC user information command
export const ircUserInfoCommand: SlashCommand = {
  data: {
    name: 'irc-userinfo',
    description: 'Get detailed information about IRC users',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'lookup',
        description: 'Look up detailed information about a specific IRC user',
        options: [
          {
            type: 'STRING',
            name: 'nick',
            description: 'IRC nickname to look up',
            required: true
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'search',
        description: 'Search for IRC users by various criteria',
        options: [
          {
            type: 'STRING',
            name: 'nick',
            description: 'Search by nickname (partial match)',
            required: false
          },
          {
            type: 'STRING',
            name: 'hostname',
            description: 'Search by hostname (partial match)',
            required: false
          },
          {
            type: 'STRING',
            name: 'realname',
            description: 'Search by real name (partial match)',
            required: false
          },
          {
            type: 'STRING',
            name: 'channel',
            description: 'Search users in specific channel',
            required: false
          },
          {
            type: 'BOOLEAN',
            name: 'operators_only',
            description: 'Show only IRC operators',
            required: false
          },
          {
            type: 'BOOLEAN',
            name: 'secure_only',
            description: 'Show only users with secure connections',
            required: false
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'stats',
        description: 'Show IRC user tracking statistics'
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({
        content: '❌ You need Administrator permissions to use this command.',
        ephemeral: true
      });
      return;
    }

    // IRC connection check
    if (!bot.isIRCConnected()) {
      await interaction.reply({
        content: '❌ **IRC Not Connected**\n\nThe IRC connection is currently down. Please wait for reconnection or check bot status.',
        ephemeral: true
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'lookup': {
          const nick = interaction.options.getString('nick', true);
          const userInfo = bot.ircUserManager.getUserInfo(nick);
          
          if (!userInfo) {
            await interaction.reply({ 
              content: `❌ **User Not Found**\n\nNo information available for IRC user "${nick}". The user may not be online or in any tracked channels.`,
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle(`👤 IRC User Information: ${userInfo.nick}`)
            .setColor('#3498db')
            .setTimestamp();

          // Basic info
          embed.addField('Nickname', userInfo.nick, true);
          if (userInfo.realname) embed.addField('Real Name', userInfo.realname, true);
          if (userInfo.username) embed.addField('Username', userInfo.username, true);
          
          // Connection info
          if (userInfo.hostname) {
            embed.addField('Hostname/IP', userInfo.hostname, true);
          }
          if (userInfo.server) embed.addField('IRC Server', userInfo.server, true);
          
          // Account and security
          if (userInfo.account) embed.addField('Services Account', userInfo.account, true);
          embed.addField('Secure Connection', userInfo.isSecure ? '🔒 Yes (SSL/TLS)' : '❌ No', true);
          
          // Status
          embed.addField('IRC Operator', userInfo.isOperator ? '⭐ Yes' : 'No', true);
          embed.addField('Voice Status', userInfo.isVoiced ? '🗣️ Voiced' : 'Normal', true);
          
          // Timing info
          if (userInfo.signonTime) {
            embed.addField('Sign-on Time', `<t:${Math.floor(userInfo.signonTime / 1000)}:f>`, true);
          }
          if (userInfo.idleTime !== undefined) {
            const idleMinutes = Math.floor(userInfo.idleTime / 60);
            const idleHours = Math.floor(idleMinutes / 60);
            const idleDisplay = idleHours > 0 
              ? `${idleHours}h ${idleMinutes % 60}m`
              : `${idleMinutes}m`;
            embed.addField('Idle Time', idleDisplay, true);
          }
          
          // Channels
          if (userInfo.channels.length > 0) {
            const channelList = userInfo.channels.slice(0, 10).join(', ');
            const channelText = userInfo.channels.length > 10 
              ? `${channelList} (+${userInfo.channels.length - 10} more)`
              : channelList;
            embed.addField(`Channels (${userInfo.channels.length})`, channelText, false);
          }

          // Last seen
          const lastSeenTime = Math.floor(userInfo.lastSeen / 1000);
          embed.addField('Last Seen', `<t:${lastSeenTime}:R>`, true);

          if (userInfo.awayMessage) {
            embed.addField('Away Message', userInfo.awayMessage, false);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'search': {
          interface UserSearchCriteria {
            nick?: string;
            hostname?: string;
            realname?: string;
            channel?: string;
            isOperator?: boolean;
            isSecure?: boolean;
          }

          const searchCriteria: UserSearchCriteria = {};

          const nick = interaction.options.getString('nick');
          const hostname = interaction.options.getString('hostname');
          const realname = interaction.options.getString('realname');
          const channel = interaction.options.getString('channel');
          const operatorsOnly = interaction.options.getBoolean('operators_only');
          const secureOnly = interaction.options.getBoolean('secure_only');

          if (nick) searchCriteria.nick = nick;
          if (hostname) searchCriteria.hostname = hostname;
          if (realname) searchCriteria.realname = realname;
          if (channel) searchCriteria.channel = channel;
          if (operatorsOnly) searchCriteria.isOperator = true;
          if (secureOnly) searchCriteria.isSecure = true;

          if (Object.keys(searchCriteria).length === 0) {
            await interaction.reply({ 
              content: '❌ **No Search Criteria**\n\nPlease provide at least one search criterion.',
              ephemeral: true 
            });
            return;
          }

          const results = bot.ircUserManager.searchUsers(searchCriteria);

          if (results.length === 0) {
            await interaction.reply({ 
              content: '🔍 **No Results Found**\n\nNo IRC users match your search criteria.',
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle(`🔍 IRC User Search Results`)
            .setColor('#e74c3c')
            .setTimestamp();

          // Show search criteria
          const criteriaText = Object.entries(searchCriteria)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(', ');
          embed.setDescription(`**Search criteria:** ${criteriaText}\n**Found ${results.length} user(s)**`);

          // Show up to 20 results
          const displayResults = results.slice(0, 20);
          
          for (let i = 0; i < displayResults.length; i += 2) {
            const user1 = displayResults[i];
            const user2 = displayResults[i + 1];
            
            const formatUser = (user: IRCUserInfo) => {
              let info = `**${user.nick}**`;
              if (user.realname) info += `\n*${user.realname}*`;
              if (user.hostname) info += `\n\`${user.hostname}\``;
              if (user.isOperator) info += '\n⭐ IRC Op';
              if (user.isSecure) info += '\n🔒 Secure';
              info += `\nChannels: ${user.channels.length}`;
              return info;
            };

            if (user2) {
              embed.addField(`User ${i + 1}`, formatUser(user1), true);
              embed.addField(`User ${i + 2}`, formatUser(user2), true);
              embed.addField('\u200B', '\u200B', true); // Spacer
            } else {
              embed.addField(`User ${i + 1}`, formatUser(user1), true);
            }
          }

          if (results.length > 20) {
            embed.setFooter({ text: `Showing first 20 of ${results.length} results` });
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'stats': {
          const stats = bot.ircUserManager.getStats();
          const serverInfo = bot.ircUserManager.getServerInfo();
          
          const embed = new MessageEmbed()
            .setTitle('📊 IRC User Tracking Statistics')
            .setColor('#9b59b6')
            .setTimestamp();

          embed.addField('Total Tracked Users', `${stats.totalUsers}`, true);
          embed.addField('Total Channels', `${stats.totalChannels}`, true);
          embed.addField('Users with Full Info', `${stats.usersWithFullInfo}`, true);
          embed.addField('IRC Operators', `${stats.operatorCount}`, true);
          embed.addField('Secure Connections', `${stats.secureUsers}`, true);
          embed.addField('Data Completeness', `${Math.round((stats.usersWithFullInfo / Math.max(stats.totalUsers, 1)) * 100)}%`, true);

          if (serverInfo.name) {
            embed.addField('IRC Server', serverInfo.name, true);
          }
          if (serverInfo.network) {
            embed.addField('Network', serverInfo.network, true);
          }

          // Server capabilities
          if (serverInfo.supportedFeatures.size > 0) {
            const features = Array.from(serverInfo.supportedFeatures.entries())
              .slice(0, 5)
              .map(([key, value]) => typeof value === 'string' ? `${key}=${value}` : key)
              .join(', ');
            embed.addField('Server Features', features, false);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in IRC user info command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute IRC user info command.', 
        ephemeral: true 
      });
    }
  }
};

// IRC channel information command
export const ircChannelInfoCommand: SlashCommand = {
  data: {
    name: 'irc-channelinfo',
    description: 'Get detailed information about IRC channels',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'info',
        description: 'Get detailed information about a specific IRC channel',
        options: [
          {
            type: 'STRING',
            name: 'channel',
            description: 'IRC channel name (e.g., #general)',
            required: true
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'users',
        description: 'List all users in an IRC channel with their modes',
        options: [
          {
            type: 'STRING',
            name: 'channel',
            description: 'IRC channel name (e.g., #general)',
            required: true
          },
          {
            type: 'BOOLEAN',
            name: 'show_operators_only',
            description: 'Show only operators and voiced users',
            required: false
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'list',
        description: 'List all tracked IRC channels'
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    try {
      // Admin permission check
      if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
        await interaction.reply({
          content: '❌ You need Administrator permissions to use this command.',
          ephemeral: true
        });
        return;
      }

      // IRC connection check
      if (!bot.isIRCConnected()) {
        await interaction.reply({
          content: '❌ **IRC Not Connected**\n\nThe IRC connection is currently down. Please wait for reconnection or check bot status.',
          ephemeral: true
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'info': {
          const channelName = interaction.options.getString('channel', true);
          const channelInfo = bot.ircUserManager.getChannelInfo(channelName);
          
          if (!channelInfo) {
            await interaction.reply({ 
              content: `❌ **Channel Not Found**\n\nNo information available for IRC channel "${channelName}". The bot may not be in this channel.`,
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle(`📺 IRC Channel Information: ${channelInfo.name}`)
            .setColor('#2ecc71')
            .setTimestamp();

          embed.addField('Channel Name', channelInfo.name, true);
          embed.addField('User Count', `${channelInfo.userCount}`, true);
          
          if (channelInfo.topic) {
            embed.addField('Topic', channelInfo.topic, false);
            if (channelInfo.topicSetBy) {
              const topicInfo = channelInfo.topicSetAt 
                ? `Set by ${channelInfo.topicSetBy} <t:${Math.floor(channelInfo.topicSetAt / 1000)}:R>`
                : `Set by ${channelInfo.topicSetBy}`;
              embed.addField('Topic Info', topicInfo, true);
            }
          }

          if (channelInfo.modes.length > 0) {
            embed.addField('Channel Modes', channelInfo.modes.join(', '), true);
          }

          if (channelInfo.created) {
            embed.addField('Created', `<t:${Math.floor(channelInfo.created / 1000)}:f>`, true);
          }

          // Show operators and voiced users
          const operators = Array.from(channelInfo.users.values())
            .filter(user => user.isOperator)
            .map(user => user.nick)
            .slice(0, 10);
          
          if (operators.length > 0) {
            const opList = operators.length > 10 
              ? `${operators.slice(0, 10).join(', ')} (+${operators.length - 10} more)`
              : operators.join(', ');
            embed.addField(`Operators (${operators.length})`, opList, false);
          }

          const voiced = Array.from(channelInfo.users.values())
            .filter(user => user.isVoiced && !user.isOperator)
            .map(user => user.nick)
            .slice(0, 10);
          
          if (voiced.length > 0) {
            const voiceList = voiced.length > 10 
              ? `${voiced.slice(0, 10).join(', ')} (+${voiced.length - 10} more)`
              : voiced.join(', ');
            embed.addField(`Voiced Users (${voiced.length})`, voiceList, false);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'users': {
          const channelName = interaction.options.getString('channel', true);
          const showOperatorsOnly = interaction.options.getBoolean('show_operators_only') || false;
          
          const channelUsers = bot.ircUserManager.getChannelUsers(channelName);
          
          if (channelUsers.length === 0) {
            await interaction.reply({ 
              content: `❌ **Channel Not Found**\n\nNo users found for IRC channel "${channelName}". The bot may not be in this channel.`,
              ephemeral: true 
            });
            return;
          }

          let filteredUsers = channelUsers;
          if (showOperatorsOnly) {
            filteredUsers = channelUsers.filter(user => user.isOperator || user.isVoiced);
          }

          const embed = new MessageEmbed()
            .setTitle(`👥 Users in ${channelName}`)
            .setColor('#f39c12')
            .setTimestamp();

          embed.setDescription(`**${filteredUsers.length}** ${showOperatorsOnly ? 'privileged ' : ''}users found`);

          // Sort users by privilege level
          const sortedUsers = filteredUsers.sort((a, b) => {
            if (a.isOperator && !b.isOperator) return -1;
            if (!a.isOperator && b.isOperator) return 1;
            if (a.isVoiced && !b.isVoiced) return -1;
            if (!a.isVoiced && b.isVoiced) return 1;
            return a.nick.localeCompare(b.nick);
          });

          // Display users in chunks
          const userChunks: IRCChannelUser[][] = [];
          for (let i = 0; i < sortedUsers.length; i += 30) {
            userChunks.push(sortedUsers.slice(i, i + 30));
          }

          for (let chunkIndex = 0; chunkIndex < Math.min(userChunks.length, 3); chunkIndex++) {
            const chunk = userChunks[chunkIndex];
            const userList = chunk.map(user => {
              let prefix = '';
              if (user.isOperator) prefix = '@';
              else if (user.isHalfOperator) prefix = '%';
              else if (user.isVoiced) prefix = '+';
              
              return `${prefix}${user.nick}`;
            }).join(', ');

            const fieldName = chunkIndex === 0 ? 'Users' : `Users (continued ${chunkIndex + 1})`;
            embed.addField(fieldName, userList, false);
          }

          if (userChunks.length > 3) {
            embed.setFooter({ text: `Showing first 90 users. Total: ${sortedUsers.length}` });
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'list': {
          const channels = bot.ircUserManager.getAllChannels();
          
          if (channels.length === 0) {
            await interaction.reply({ 
              content: '📺 **No Channels Tracked**\n\nThe bot is not currently tracking any IRC channels.',
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle('📺 Tracked IRC Channels')
            .setColor('#e67e22')
            .setTimestamp();

          embed.setDescription(`**${channels.length}** channels being tracked`);

          // Sort channels by user count
          const sortedChannels = channels.sort((a, b) => b.userCount - a.userCount);

          // Display channels in chunks
          for (let i = 0; i < Math.min(sortedChannels.length, 25); i += 5) {
            const chunk = sortedChannels.slice(i, i + 5);
            const channelList = chunk.map(channel => {
              let info = `**${channel.name}** (${channel.userCount} users)`;
              if (channel.topic) {
                const shortTopic = channel.topic.length > 50 
                  ? `${channel.topic.substring(0, 50)}...`
                  : channel.topic;
                info += `\n*${shortTopic}*`;
              }
              return info;
            }).join('\n\n');

            const fieldName = i === 0 ? 'Channels' : `Channels (${i + 1}-${Math.min(i + 5, sortedChannels.length)})`;
            embed.addField(fieldName, channelList, false);
          }

          if (sortedChannels.length > 25) {
            embed.setFooter({ text: `Showing first 25 channels. Total: ${sortedChannels.length}` });
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in IRC channel info command:', error);

      // Try to reply, but catch if interaction has expired
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ Failed to execute IRC channel info command.',
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: '❌ Failed to execute IRC channel info command.'
          });
        }
      } catch (replyError) {
        // Interaction expired or already handled - log but don't crash
        logger.warn('Could not send error reply for IRC channel info command (interaction may have expired):', replyError);
      }
    }
  }
};

// IRC WHO command
export const ircWhoCommand: SlashCommand = {
  data: {
    name: 'irc-who',
    description: 'Execute WHO command to find IRC users matching patterns',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'STRING',
        name: 'pattern',
        description: 'Pattern to search for (e.g., *.example.com, #channel, nick*)',
        required: true
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({
        content: '❌ You need Administrator permissions to use this command.',
        ephemeral: true
      });
      return;
    }

    // IRC connection check
    if (!bot.isIRCConnected()) {
      await interaction.reply({
        content: '❌ **IRC Not Connected**\n\nThe IRC connection is currently down. Please wait for reconnection or check bot status.',
        ephemeral: true
      });
      return;
    }

    try {
      const pattern = interaction.options.getString('pattern', true);

      await interaction.deferReply({ ephemeral: true });

      try {
        // Add timeout protection for WHO query (max 30 seconds)
        const whoWithTimeout = Promise.race([
          bot.ircUserManager.whoQuery(pattern),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('IRC WHO query timed out after 30s')), 30000)
          )
        ]);

        const users = await whoWithTimeout;
        
        if (users.length === 0) {
          await interaction.editReply({ 
            content: `🔍 **WHO Query Results**\n\nNo users found matching pattern: \`${pattern}\`` 
          });
          return;
        }

        const embed = new MessageEmbed()
          .setTitle(`🔍 WHO Query Results: ${pattern}`)
          .setColor('#e74c3c')
          .setTimestamp();

        embed.setDescription(`**${users.length}** user(s) found matching pattern \`${pattern}\``);

        // Show up to 20 users
        const displayUsers = users.slice(0, 20);
        
        for (let i = 0; i < displayUsers.length; i += 2) {
          const user1 = displayUsers[i];
          const user2 = displayUsers[i + 1];
          
          const formatUser = (user: IRCUserInfo) => {
            let info = `**${user.nick}**`;
            if (user.realname) info += `\n*${user.realname}*`;
            if (user.hostname) info += `\n\`${user.hostname}\``;
            if (user.server) info += `\nServer: ${user.server}`;
            if (user.isOperator) info += '\n⭐ IRC Op';
            if (user.isAway) info += '\n😴 Away';
            if (user.isSecure) info += '\n🔒 Secure';
            return info;
          };

          if (user2) {
            embed.addField(`User ${i + 1}`, formatUser(user1), true);
            embed.addField(`User ${i + 2}`, formatUser(user2), true);
            embed.addField('\u200B', '\u200B', true); // Spacer
          } else {
            embed.addField(`User ${i + 1}`, formatUser(user1), true);
          }
        }

        if (users.length > 20) {
          embed.setFooter({ text: `Showing first 20 of ${users.length} results` });
        }

        await interaction.editReply({ embeds: [embed] });
        
      } catch (error) {
        await interaction.editReply({ 
          content: `❌ **WHO Query Failed**\n\nError executing WHO query for pattern \`${pattern}\`: ${(error as Error).message}` 
        });
      }
      
    } catch (error) {
      logger.error('Error in IRC WHO command:', error);
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: '❌ Failed to execute WHO command.' 
        });
      } else {
        await interaction.reply({ 
          content: '❌ Failed to execute WHO command.', 
          ephemeral: true 
        });
      }
    }
  }
};

// Raw IRC command execution
export const ircCommandCommand: SlashCommand = {
  data: {
    name: 'irc-command',
    description: 'Execute raw IRC commands (DANGEROUS - admin only)',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'send',
        description: 'Send a raw IRC command',
        options: [
          {
            type: 'STRING',
            name: 'command',
            description: 'IRC command to send (e.g., PRIVMSG, MODE, KICK)',
            required: true
          },
          {
            type: 'STRING',
            name: 'arguments',
            description: 'Command arguments (space-separated)',
            required: false
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'raw',
        description: 'Send a raw IRC protocol message',
        options: [
          {
            type: 'STRING',
            name: 'message',
            description: 'Raw IRC message (advanced users only)',
            required: true
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'moderation',
        description: 'Common moderation commands',
        options: [
          {
            type: 'STRING',
            name: 'action',
            description: 'Moderation action',
            required: true,
            choices: [
              { name: 'Kick user', value: 'kick' },
              { name: 'Ban user', value: 'ban' },
              { name: 'Set topic', value: 'topic' },
              { name: 'Set mode', value: 'mode' },
              { name: 'Invite user', value: 'invite' }
            ]
          },
          {
            type: 'STRING',
            name: 'target',
            description: 'Channel or user target',
            required: true
          },
          {
            type: 'STRING',
            name: 'parameter',
            description: 'User, topic, mode, or reason',
            required: false
          },
          {
            type: 'STRING',
            name: 'reason',
            description: 'Reason for kick/ban',
            required: false
          }
        ]
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({
        content: '❌ You need Administrator permissions to use this command.',
        ephemeral: true
      });
      return;
    }

    // IRC connection check
    if (!bot.isIRCConnected()) {
      await interaction.reply({
        content: '❌ **IRC Not Connected**\n\nThe IRC connection is currently down. Cannot send IRC commands.',
        ephemeral: true
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'send': {
          const command = interaction.options.getString('command', true).toUpperCase();
          const args = interaction.options.getString('arguments');

          // Basic safety checks
          const dangerousCommands = ['QUIT', 'SQUIT', 'CONNECT', 'OPER'];
          if (dangerousCommands.includes(command)) {
            await interaction.reply({
              content: `❌ **Command Blocked**\n\nThe command \`${command}\` is not allowed for safety reasons.`,
              ephemeral: true
            });
            return;
          }

          try {
            if (args) {
              // Support arguments with spaces by treating everything after the first space as a single final argument
              const argParts = args.trim().split(' ');
              const firstArg = argParts.shift();
              const restArgs = argParts.join(' ');
              
              const finalArgs: string[] = [];
              if (firstArg) finalArgs.push(firstArg);
              if (restArgs) finalArgs.push(restArgs);

              bot.executeIRCCommand(command, ...finalArgs);
            } else {
              bot.executeIRCCommand(command);
            }
            
            await interaction.reply({ 
              content: `✅ **IRC Command Sent**\n\nExecuted: \`${command}${args ? ' ' + args : ''}\``,
              ephemeral: true 
            });
          } catch (error) {
            await interaction.reply({ 
              content: `❌ **Command Failed**\n\nError executing \`${command}\`: ${(error as Error).message}`,
              ephemeral: true 
            });
          }
          break;
        }

        case 'raw': {
          const rawMessage = interaction.options.getString('message', true);
          
          // Safety check for dangerous raw commands
          if (rawMessage.toUpperCase().includes('QUIT') || rawMessage.toUpperCase().includes('SQUIT')) {
            await interaction.reply({ 
              content: '❌ **Raw Message Blocked**\n\nQUIT and SQUIT commands are not allowed.',
              ephemeral: true 
            });
            return;
          }

          try {
            bot.sendRawIRC(rawMessage);
            
            await interaction.reply({ 
              content: `✅ **Raw IRC Message Sent**\n\nSent: \`${rawMessage}\``,
              ephemeral: true 
            });
          } catch (error) {
            await interaction.reply({ 
              content: `❌ **Raw Message Failed**\n\nError sending raw message: ${(error as Error).message}`,
              ephemeral: true 
            });
          }
          break;
        }

        case 'moderation': {
          const action = interaction.options.getString('action', true);
          const target = interaction.options.getString('target', true);
          const parameter = interaction.options.getString('parameter');
          const reason = interaction.options.getString('reason');
          
          try {
            let commandStr = '';
            
            switch (action) {
              case 'kick':
                if (!parameter) {
                  await interaction.reply({ 
                    content: '❌ **Missing Parameter**\n\nKick command requires a user parameter.',
                    ephemeral: true 
                  });
                  return;
                }
                commandStr = `KICK ${target} ${parameter}${reason ? ' :' + reason : ''}`;
                bot.executeIRCCommand('KICK', target, parameter, ...(reason ? [reason] : []));
                break;
                
              case 'ban':
                if (!parameter) {
                  await interaction.reply({ 
                    content: '❌ **Missing Parameter**\n\nBan command requires a user/hostmask parameter.',
                    ephemeral: true 
                  });
                  return;
                }
                commandStr = `MODE ${target} +b ${parameter}`;
                bot.executeIRCCommand('MODE', target, '+b', parameter);
                break;
                
              case 'topic':
                if (!parameter) {
                  await interaction.reply({ 
                    content: '❌ **Missing Parameter**\n\nTopic command requires a topic parameter.',
                    ephemeral: true 
                  });
                  return;
                }
                commandStr = `TOPIC ${target} :${parameter}`;
                bot.executeIRCCommand('TOPIC', target, parameter);
                break;
                
              case 'mode':
                if (!parameter) {
                  await interaction.reply({ 
                    content: '❌ **Missing Parameter**\n\nMode command requires a mode parameter.',
                    ephemeral: true 
                  });
                  return;
                }
                commandStr = `MODE ${target} ${parameter}`;
                bot.executeIRCCommand('MODE', target, parameter);
                break;
                
              case 'invite':
                if (!parameter) {
                  await interaction.reply({ 
                    content: '❌ **Missing Parameter**\n\nInvite command requires a user parameter.',
                    ephemeral: true 
                  });
                  return;
                }
                commandStr = `INVITE ${parameter} ${target}`;
                bot.executeIRCCommand('INVITE', parameter, target);
                break;
            }
            
            await interaction.reply({ 
              content: `✅ **Moderation Command Sent**\n\nExecuted: \`${commandStr}\``,
              ephemeral: true 
            });
            
          } catch (error) {
            await interaction.reply({ 
              content: `❌ **Moderation Command Failed**\n\nError executing ${action}: ${(error as Error).message}`,
              ephemeral: true 
            });
          }
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in IRC command execution:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute IRC command.', 
        ephemeral: true 
      });
    }
  }
};

// IRC channel lists command (ban, quiet, exception, invite lists)
export const ircListsCommand: SlashCommand = {
  data: {
    name: 'irc-lists',
    description: 'View IRC channel ban/quiet/exception/invite lists',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'STRING',
        name: 'channel',
        description: 'IRC channel name (e.g., #general)',
        required: true
      },
      {
        type: 'STRING',
        name: 'list_type',
        description: 'Type of list to view',
        required: true,
        choices: [
          { name: 'Ban list (+b)', value: 'b' },
          { name: 'Quiet list (+q)', value: 'q' },
          { name: 'Exception list (+e)', value: 'e' },
          { name: 'Invite list (+I)', value: 'I' }
        ]
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const channel = interaction.options.getString('channel', true);
      const listType = interaction.options.getString('list_type', true);
      
      // Ensure channel starts with #
      const channelName = channel.startsWith('#') ? channel : `#${channel}`;
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        // Send MODE command to query the list
        bot.executeIRCCommand('MODE', channelName, `+${listType}`);
        
        // For now, just confirm the command was sent
        // In a full implementation, you'd collect the responses
        const listNames = {
          'b': 'Ban List',
          'q': 'Quiet List', 
          'e': 'Exception List',
          'I': 'Invite List'
        };
        
        await interaction.editReply({ 
          content: `✅ **${listNames[listType as keyof typeof listNames]} Query Sent**\n\nRequested ${listNames[listType as keyof typeof listNames].toLowerCase()} for ${channelName}.\n\n⚠️ **Note**: Results will appear in IRC client logs. Full list viewing in Discord will be implemented in a future update.`
        });
        
      } catch (error) {
        await interaction.editReply({ 
          content: `❌ **List Query Failed**\n\nError querying ${listType} list for ${channelName}: ${(error as Error).message}` 
        });
      }
      
    } catch (error) {
      logger.error('Error in IRC lists command:', error);
      if (interaction.deferred) {
        await interaction.editReply({ 
          content: '❌ Failed to execute lists command.' 
        });
      } else {
        await interaction.reply({ 
          content: '❌ Failed to execute lists command.', 
          ephemeral: true 
        });
      }
    }
  }
};

// IRC Channel discovery and management command
export const ircChannelDiscoveryCommand: SlashCommand = {
  data: {
    name: 'irc-channels',
    description: 'Discover and manage IRC channels',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'list',
        description: 'List available IRC channels',
        options: [
          {
            type: 'STRING',
            name: 'pattern',
            description: 'Channel name pattern to search for (e.g., *game*, #dev*)',
            required: false
          },
          {
            type: 'INTEGER',
            name: 'min_users',
            description: 'Minimum number of users (default: 1)',
            required: false,
            choices: [
              { name: '1+', value: 1 },
              { name: '5+', value: 5 },
              { name: '10+', value: 10 },
              { name: '25+', value: 25 },
              { name: '50+', value: 50 },
              { name: '100+', value: 100 }
            ]
          },
          {
            type: 'INTEGER',
            name: 'limit',
            description: 'Maximum number of channels to show (default: 50)',
            required: false,
            choices: [
              { name: '10', value: 10 },
              { name: '25', value: 25 },
              { name: '50', value: 50 },
              { name: '100', value: 100 },
              { name: '200', value: 200 }
            ]
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'join',
        description: 'Join an IRC channel',
        options: [
          {
            type: 'STRING',
            name: 'channel',
            description: 'IRC channel name (e.g., #general)',
            required: true
          },
          {
            type: 'STRING',
            name: 'key',
            description: 'Channel key/password (if required)',
            required: false
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'part',
        description: 'Leave an IRC channel',
        options: [
          {
            type: 'STRING',
            name: 'channel',
            description: 'IRC channel name (e.g., #general)',
            required: true
          },
          {
            type: 'STRING',
            name: 'message',
            description: 'Part message (optional)',
            required: false
          }
        ]
      }
    ]
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({
        content: '❌ You need administrator permissions to use this command.',
        ephemeral: true
      });
      return;
    }

    try {
      // Check IRC connection before proceeding
      if (!bot.isIRCConnected()) {
        await interaction.reply({
          content: '❌ **IRC Not Connected**\n\nThe IRC connection is currently down. Please wait for reconnection or check bot status.',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'list': {
          const pattern = interaction.options.getString('pattern');
          const minUsers = interaction.options.getInteger('min_users') || 1;
          const limit = interaction.options.getInteger('limit') || 50;

          try {
            // Add timeout protection for IRC LIST command (max 30 seconds)
            const listChannelsWithTimeout = Promise.race([
              bot.ircUserManager.listChannels(pattern || undefined),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('IRC channel list request timed out after 30s')), 30000)
              )
            ]);

            const channels = await listChannelsWithTimeout;
            
            // Filter by minimum users
            const filteredChannels = channels
              .filter(ch => ch.userCount >= minUsers)
              .sort((a, b) => b.userCount - a.userCount)
              .slice(0, limit);
            
            if (filteredChannels.length === 0) {
              await interaction.editReply({ 
                content: `🔍 **IRC Channel List**\n\nNo channels found${pattern ? ` matching pattern: \`${pattern}\`` : ''}${minUsers > 1 ? ` with ${minUsers}+ users` : ''}.` 
              });
              return;
            }
            
            // Create chunks for multiple messages if needed
            const channelChunks: IRCChannelListItem[][] = [];
            const chunkSize = 20; // Show 20 channels per message
            for (let i = 0; i < filteredChannels.length; i += chunkSize) {
              channelChunks.push(filteredChannels.slice(i, i + chunkSize));
            }
            
            // First chunk in the reply
            const firstChunk = channelChunks[0];
            const embed = new MessageEmbed()
              .setTitle('🔍 IRC Channel Discovery')
              .setColor(0x00ff00)
              .setTimestamp();
            
            if (pattern) {
              embed.addField('🎯 Search Pattern', `\`${pattern}\``, true);
            }
            embed.addField('👥 Min Users', `${minUsers}+`, true);
            embed.addField('📊 Total Found', `${filteredChannels.length}`, true);
            
            const channelList = firstChunk.map(ch => {
              const topic = ch.topic ? ` - ${ch.topic.substring(0, 50)}${ch.topic.length > 50 ? '...' : ''}` : '';
              return `**${ch.name}** (${ch.userCount} users)${topic}`;
            }).join('\n');
            
            embed.setDescription(channelList);
            
            if (channelChunks.length > 1) {
              embed.setFooter(`Showing ${firstChunk.length} of ${filteredChannels.length} channels (page 1/${channelChunks.length})`);
            }
            
            await interaction.editReply({ embeds: [embed] });
            
            // Send additional chunks as follow-ups
            for (let i = 1; i < channelChunks.length && i < 5; i++) { // Limit to 5 total messages
              const chunk = channelChunks[i];
              const chunkEmbed = new MessageEmbed()
                .setTitle(`🔍 IRC Channel Discovery (continued)`)
                .setColor(0x00ff00)
                .setTimestamp();
              
              const chunkList = chunk.map(ch => {
                const topic = ch.topic ? ` - ${ch.topic.substring(0, 50)}${ch.topic.length > 50 ? '...' : ''}` : '';
                return `**${ch.name}** (${ch.userCount} users)${topic}`;
              }).join('\n');
              
              chunkEmbed.setDescription(chunkList);
              chunkEmbed.setFooter(`Page ${i + 1}/${channelChunks.length}`);
              
              await interaction.followUp({ embeds: [chunkEmbed], ephemeral: true });
            }
            
          } catch (error) {
            logger.error('Error listing IRC channels:', error);
            await interaction.editReply({ 
              content: `❌ Failed to list IRC channels: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          }
          break;
        }
        
        case 'join': {
          const channel = interaction.options.getString('channel', true);
          const key = interaction.options.getString('key');
          
          // Validate channel name (exclude spaces, commas, colons, and control characters)
          // eslint-disable-next-line no-control-regex
          const channelRegex = /^[#&!+][^\s,:\x00-\x1F\x7F]+$/; // IRC channel name validation
          if (!channelRegex.test(channel)) {
            await interaction.editReply({
              content: '❌ Invalid IRC channel name. It must start with #, &, !, or + and cannot contain spaces, commas, colons, or control characters.'
            });
            return;
          }
          
          try {
            bot.joinIRCChannel(channel, key || undefined);
            
            const message = `✅ **Joined IRC Channel (Session Only)**\n\n` +
              `📍 **Channel:** ${channel}\n` +
              `🔑 **Key:** ${key ? 'Yes (hidden)' : 'None'}\n\n` +
              `The bot has joined the IRC channel for this session. To make this permanent, add it to your configuration file and restart the bot.`;
            
            await interaction.editReply({ content: message });
            
          } catch (error) {
            logger.error('Error joining IRC channel:', error);
            await interaction.editReply({ 
              content: `❌ Failed to join IRC channel: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          }
          break;
        }
        
        case 'part': {
          const channel = interaction.options.getString('channel', true);
          const message = interaction.options.getString('message');
          
          // Validate channel name (exclude spaces, commas, colons, and control characters)
          // eslint-disable-next-line no-control-regex
          const channelRegex = /^[#&!+][^\s,:\x00-\x1F\x7F]+$/; // IRC channel name validation
          if (!channelRegex.test(channel)) {
            await interaction.editReply({
              content: '❌ Invalid IRC channel name. It must start with #, &, !, or + and cannot contain spaces, commas, colons, or control characters.'
            });
            return;
          }
          
          try {
            bot.partIRCChannel(channel, message || undefined);
            
            const responseMessage = `✅ **Left IRC Channel**\n\n` +
              `📍 **Channel:** ${channel}\n` +
              `💬 **Part Message:** ${message || 'None'}\n\n` +
              `The bot has left the IRC channel.`;
            
            await interaction.editReply({ content: responseMessage });
            
          } catch (error) {
            logger.error('Error leaving IRC channel:', error);
            await interaction.editReply({ 
              content: `❌ Failed to leave IRC channel: ${error instanceof Error ? error.message : 'Unknown error'}` 
            });
          }
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in IRC channel discovery command:', error);

      // Handle Discord API errors gracefully (interaction timeout, already acknowledged, etc.)
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: `❌ Failed to execute IRC channel command: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        } else {
          await interaction.reply({
            content: `❌ Failed to execute IRC channel command: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        // Interaction token may have expired (>15 min) or connection lost
        // Just log the error, don't try to reply again
        logger.error('Failed to send error message to user (interaction may have expired):', replyError);
      }
    }
  }
};

// Export all commands
export const slashCommands: SlashCommand[] = [
  statusCommand,
  usersCommand,
  pmCommand,
  directPmCommand,
  reconnectCommand,
  rateLimitCommand,
  metricsCommand,
  recoveryCommand,
  s3Command,
  mentionCommand,
  statusNotificationCommand,
  ircUserInfoCommand,
  ircChannelInfoCommand,
  ircWhoCommand,
  ircCommandCommand,
  ircListsCommand,
  ircChannelDiscoveryCommand
];

// Command registration utility
export async function registerSlashCommands(bot: Bot): Promise<void> {
  try {
    if (!bot.discord.application) {
      logger.error('Discord application not available for command registration');
      return;
    }

    const commandData = slashCommands.map(command => command.data);

    // Use guild-specific registration for instant availability
    // Global registration takes up to 1 hour to propagate
    const guilds = bot.discord.guilds.cache;

    if (guilds.size > 0) {
      // Register to all guilds the bot is in (instant)
      let successCount = 0;
      for (const [guildId, guild] of guilds) {
        try {
          await guild.commands.set(commandData);
          logger.info(`Registered ${slashCommands.length} slash commands to guild: ${guild.name} (${guildId})`);
          successCount++;
        } catch (guildError) {
          logger.error(`Failed to register commands to guild ${guild.name}:`, guildError);
        }
      }

      if (successCount > 0) {
        logger.info(`✅ Successfully registered slash commands to ${successCount} guild(s)`);
      } else {
        logger.warn('Failed to register commands to any guild, falling back to global');
        await bot.discord.application.commands.set(commandData);
        logger.info(`Registered ${slashCommands.length} slash commands globally (may take up to 1 hour to appear)`);
      }
    } else {
      // No guilds available, register globally
      await bot.discord.application.commands.set(commandData);
      logger.info(`Registered ${slashCommands.length} slash commands globally (may take up to 1 hour to appear)`);
    }

  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}

// Command handler
export async function handleSlashCommand(interaction: CommandInteraction, bot: Bot): Promise<void> {
  const command = slashCommands.find(cmd => cmd.data.name === interaction.commandName);
  
  if (!command) {
    await interaction.reply({ 
      content: '❌ Unknown command.', 
      ephemeral: true 
    });
    return;
  }

  try {
    await command.execute(interaction, bot);
    
    // Record slash command metrics
    bot.metrics.recordCommand(true);
    
  } catch (error) {
    logger.error(`Error executing slash command ${interaction.commandName}:`, error);

    const errorMessage = '❌ There was an error executing this command.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

// Button interaction handler
export async function handleButtonInteraction(interaction: ButtonInteraction, bot: Bot): Promise<void> {
  const customId = interaction.customId;

  // Handle S3 list pagination buttons
  if (customId.startsWith('s3_list_')) {
    await handleS3ListPagination(interaction, bot);
    return;
  }

  // Unknown button
  await interaction.reply({
    content: '❌ Unknown button interaction.',
    ephemeral: true
  });
}

// Handle S3 list pagination
async function handleS3ListPagination(interaction: ButtonInteraction, bot: Bot): Promise<void> {
  await interaction.deferUpdate();

  try {
    // Parse customId: "s3_list_next_TOKEN_PREFIX" or "s3_list_prev_TOKEN_PREFIX"
    const parts = interaction.customId.split('_');
    if (parts.length < 4) {
      await interaction.editReply({
        content: '❌ Invalid pagination button format.',
        components: []
      });
      return;
    }

    const _action = parts[2]; // 'next' or 'prev' - reserved for future use
    const token = parts[3] !== 'null' ? parts[3] : undefined;
    const prefix = parts[4] !== 'null' ? parts[4] : undefined;

    // Get S3 configuration from bot
    const guildId = interaction.guildId!;
    if (!bot.persistence) {
      await interaction.editReply({
        content: '❌ Database not available.',
        components: []
      });
      return;
    }

    const config = await bot.persistence.getS3Config(guildId);
    if (!config) {
      await interaction.editReply({
        content: '❌ S3 is not configured.',
        components: []
      });
      return;
    }

    // Create uploader and fetch next page
    const uploader = new S3Uploader({
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      endpoint: config.endpoint,
      keyPrefix: config.keyPrefix,
      publicUrlBase: config.publicUrlBase,
      forcePathStyle: config.forcePathStyle
    });
    const result = await uploader.listObjects(prefix, token);

    if (result.objects.length === 0) {
      await interaction.editReply({
        content: '📁 **No more files found**',
        components: []
      });
      return;
    }

    // Build embed with file list
    const embed = new MessageEmbed()
      .setTitle(`📁 Files in ${config.bucket}`)
      .setColor('#3498db')
      .setTimestamp();

    if (prefix) {
      embed.setDescription(`Prefix: \`${prefix}\``);
    }

    const fileList = result.objects.map(obj => {
      const sizeKB = (obj.size / 1024).toFixed(2);
      const date = obj.lastModified.toISOString().split('T')[0];
      return `\`${obj.key}\` - ${sizeKB} KB - ${date}`;
    }).join('\n');

    embed.addField(`Files (${result.objects.length})`, fileList.substring(0, 1024), false);

    // Add pagination buttons
    const components: MessageActionRow[] = [];
    const buttons: MessageButton[] = [];

    // Add "Next" button if there are more results
    if (result.isTruncated && result.nextContinuationToken) {
      buttons.push(
        new MessageButton()
          .setCustomId(`s3_list_next_${result.nextContinuationToken}_${prefix || 'null'}`)
          .setLabel('Next →')
          .setStyle('PRIMARY')
      );
      embed.setFooter({ text: 'More files available' });
    } else {
      embed.setFooter({ text: 'End of list' });
    }

    if (buttons.length > 0) {
      const row = new MessageActionRow().addComponents(...buttons);
      components.push(row);
    }

    await interaction.editReply({
      embeds: [embed],
      components
    });

  } catch (error) {
    logger.error('Error handling S3 list pagination:', error);
    await interaction.editReply({
      content: `❌ Pagination failed: ${(error as Error).message}`,
      components: []
    });
  }
}