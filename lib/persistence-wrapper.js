/**
 * Runtime conditional loader for persistence
 * This JavaScript file loads the correct persistence implementation based on the runtime
 * Bun gets Bun.Database, Node.js gets sqlite3
 */

// Check if running in Bun
const isBun = typeof Bun !== 'undefined';

if (isBun) {
  // Use Bun-native SQLite
  module.exports = require('./persistence-bun');
} else {
  // Use Node.js sqlite3
  module.exports = require('./persistence');
}
