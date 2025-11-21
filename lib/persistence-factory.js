"use strict";
/**
 * Factory to select the appropriate persistence implementation
 * Uses Bun-native SQLite when running in Bun, falls back to sqlite3 for Node.js
 */
Object.defineProperty(exports, "__esModule", { value: true });
// Conditional class export based on runtime
if (typeof Bun !== 'undefined') {
    const { PersistenceService: BunPersistence } = require('./persistence-bun');
    module.exports.PersistenceService = BunPersistence;
}
else {
    const { PersistenceService: NodePersistence } = require('./persistence');
    module.exports.PersistenceService = NodePersistence;
}
