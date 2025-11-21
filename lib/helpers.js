"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBot = createBot;
const bot_1 = __importDefault(require("./bot"));
async function createBot(configFile) {
    const bot = new bot_1.default(configFile);
    await bot.connect();
    return bot;
}
