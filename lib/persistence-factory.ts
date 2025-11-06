/**
 * Factory to select the appropriate persistence implementation
 * Uses Bun-native SQLite when running in Bun, falls back to sqlite3 for Node.js
 */

// Re-export types
export type { PMThreadData, ChannelUserData } from './persistence';

// Conditional class export based on runtime
if (typeof Bun !== 'undefined') {
  const { PersistenceService: BunPersistence } = require('./persistence-bun');
  module.exports.PersistenceService = BunPersistence;
} else {
  const { PersistenceService: NodePersistence } = require('./persistence');
  module.exports.PersistenceService = NodePersistence;
}

// TypeScript type export
import type { PersistenceService as PS } from './persistence';
export type PersistenceService = PS;
