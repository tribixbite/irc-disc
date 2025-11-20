import { describe, it, expect } from 'vitest';
import { slashCommands, statusCommand, usersCommand, s3Command } from '../lib/slash-commands';

describe('Slash Commands', () => {
  it('should export correct number of commands', () => {
    expect(slashCommands).toHaveLength(17);
  });

  it('should have proper command data structure', () => {
    expect(statusCommand.data.name).toBe('irc-status');
    expect((statusCommand.data as any).description).toBe('Show IRC bridge status and statistics');
    expect(typeof statusCommand.execute).toBe('function');
  });

  it('should have users command with proper options', () => {
    expect(usersCommand.data.name).toBe('irc-users');
    expect((usersCommand.data as any).options).toBeDefined();
    expect((usersCommand.data as any).options).toHaveLength(1);
    expect((usersCommand.data as any).options![0].name).toBe('channel');
  });

  it('should have s3 command with subcommand groups', () => {
    expect(s3Command.data.name).toBe('s3');
    expect((s3Command.data as any).description).toBe('Manage S3 file storage and uploads');
    expect((s3Command.data as any).options).toBeDefined();
    expect((s3Command.data as any).options).toHaveLength(4); // config group, files group, share, status

    // Check config subcommand group
    const configGroup = (s3Command.data as any).options.find((opt: any) => opt.name === 'config');
    expect(configGroup).toBeDefined();
    expect(configGroup.type).toBe('SUB_COMMAND_GROUP');
    expect(configGroup.options).toHaveLength(4); // set, view, test, remove

    // Check files subcommand group
    const filesGroup = (s3Command.data as any).options.find((opt: any) => opt.name === 'files');
    expect(filesGroup).toBeDefined();
    expect(filesGroup.type).toBe('SUB_COMMAND_GROUP');
    expect(filesGroup.options).toHaveLength(5); // upload, list, info, rename, delete

    // Verify file operation commands exist
    const subcommandNames = filesGroup.options.map((opt: any) => opt.name);
    expect(subcommandNames).toContain('upload');
    expect(subcommandNames).toContain('list');
    expect(subcommandNames).toContain('info');
    expect(subcommandNames).toContain('rename');
    expect(subcommandNames).toContain('delete');

    // Check share subcommand
    const shareCommand = (s3Command.data as any).options.find((opt: any) => opt.name === 'share');
    expect(shareCommand).toBeDefined();
    expect(shareCommand.type).toBe('SUB_COMMAND');
    expect(shareCommand.options).toHaveLength(4); // file, channel, message, folder

    // Check status subcommand
    const statusCommand = (s3Command.data as any).options.find((opt: any) => opt.name === 'status');
    expect(statusCommand).toBeDefined();
    expect(statusCommand.type).toBe('SUB_COMMAND');
  });

  it('should have all commands with admin permissions', () => {
    for (const command of slashCommands) {
      expect(command.data.defaultMemberPermissions).toBeDefined();
    }
  });
});