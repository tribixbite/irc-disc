"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFromDiscordToIRC = formatFromDiscordToIRC;
exports.formatFromIRCToDiscord = formatFromIRCToDiscord;
const irc_formatting_1 = __importDefault(require("irc-formatting"));
const simple_markdown_1 = __importDefault(require("simple-markdown"));
const irc_colors_1 = __importDefault(require("irc-colors"));
function mdNodeToIRC(node) {
    let { content } = node;
    if (Array.isArray(content))
        content = content.map(mdNodeToIRC).join('');
    switch (node.type) {
        case 'em':
            return irc_colors_1.default.italic(content);
        case 'strong':
            return irc_colors_1.default.bold(content);
        case 'u':
            return irc_colors_1.default.underline(content);
        default:
            return content;
    }
}
function formatFromDiscordToIRC(text) {
    const markdownAST = simple_markdown_1.default.defaultInlineParse(text);
    return markdownAST.map(mdNodeToIRC).join('');
}
function formatFromIRCToDiscord(text) {
    const blocks = irc_formatting_1.default.parse(text).map((block) => ({
        // Consider reverse as italic, some IRC clients use that
        ...block,
        italic: block.italic || block.reverse,
    }));
    let mdText = '';
    for (let i = 0; i <= blocks.length; i += 1) {
        // Default to unstyled blocks when index out of range
        const block = blocks[i] || {};
        const prevBlock = blocks[i - 1] || {};
        // Add start markers when style turns from false to true
        if (!prevBlock.italic && block.italic)
            mdText += '*';
        if (!prevBlock.bold && block.bold)
            mdText += '**';
        if (!prevBlock.underline && block.underline)
            mdText += '__';
        // Add end markers when style turns from true to false
        // (and apply in reverse order to maintain nesting)
        if (prevBlock.underline && !block.underline)
            mdText += '__';
        if (prevBlock.bold && !block.bold)
            mdText += '**';
        if (prevBlock.italic && !block.italic)
            mdText += '*';
        mdText += block.text || '';
    }
    return mdText;
}
