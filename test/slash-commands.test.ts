import { describe, it, expect } from 'vitest';
import { slashCommands, statusCommand, usersCommand, s3Command } from '../lib/slash-commands';

// Type helper for testing command data structure
interface TestCommandOption {
  name: string;
  type: string;
  description?: string;
  options?: TestCommandOption[];
}

interface TestCommandData {
  name: string;
  description: string;
  options?: TestCommandOption[];
}

describe('Slash Commands', () => {
  it('should export correct number of commands', () => {
    expect(slashCommands).toHaveLength(17);
  });

  it('should have proper command data structure', () => {
    const data = statusCommand.data as unknown as TestCommandData;
    expect(statusCommand.data.name).toBe('irc-status');
    expect(data.description).toBe('Show IRC bridge status and statistics');
    expect(typeof statusCommand.execute).toBe('function');
  });

  it('should have users command with proper options', () => {
    const data = usersCommand.data as unknown as TestCommandData;
    expect(usersCommand.data.name).toBe('irc-users');
    expect(data.options).toBeDefined();
    expect(data.options).toHaveLength(1);
    expect(data.options![0].name).toBe('channel');
  });

  it('should have s3 command with subcommand groups', () => {
    const data = s3Command.data as unknown as TestCommandData;
    expect(s3Command.data.name).toBe('s3');
    expect(data.description).toBe('Manage S3 file storage and uploads');
    expect(data.options).toBeDefined();
    expect(data.options).toHaveLength(4); // config group, files group, share, status

    // Check config subcommand group
    const configGroup = data.options!.find((opt) => opt.name === 'config');
    expect(configGroup).toBeDefined();
    expect(configGroup!.type).toBe('SUB_COMMAND_GROUP');
    expect(configGroup!.options).toHaveLength(4); // set, view, test, remove

    // Check files subcommand group
    const filesGroup = data.options!.find((opt) => opt.name === 'files');
    expect(filesGroup).toBeDefined();
    expect(filesGroup!.type).toBe('SUB_COMMAND_GROUP');
    expect(filesGroup!.options).toHaveLength(5); // upload, list, info, rename, delete

    // Verify file operation commands exist
    const subcommandNames = filesGroup!.options!.map((opt) => opt.name);
    expect(subcommandNames).toContain('upload');
    expect(subcommandNames).toContain('list');
    expect(subcommandNames).toContain('info');
    expect(subcommandNames).toContain('rename');
    expect(subcommandNames).toContain('delete');

    // Check share subcommand
    const shareCommand = data.options!.find((opt) => opt.name === 'share');
    expect(shareCommand).toBeDefined();
    expect(shareCommand!.type).toBe('SUB_COMMAND');
    expect(shareCommand!.options).toHaveLength(4); // file, channel, message, folder

    // Check status subcommand
    const statusSubcommand = data.options!.find((opt) => opt.name === 'status');
    expect(statusSubcommand).toBeDefined();
    expect(statusSubcommand!.type).toBe('SUB_COMMAND');
  });

  it('should have all commands with admin permissions', () => {
    for (const command of slashCommands) {
      expect(command.data.defaultMemberPermissions).toBeDefined();
    }
  });
});