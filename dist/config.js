"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = {
    NORMAL_COOLDOWN: 3050,
    PORTAL_COOLDOWN: 12000,
    PORTAL_TIMEOUT: 40000,
    SLOW_COOLDOWN: 4050,
    MSG_REGEXP: /^\[(\w+) \| (\w+) -> mir\] (.+)/,
    PAY_REGEXP: /^(\w+) \| (\w+) hat dir \$([^\s]+) gegeben\./,
    CHATMODE_ALERT_REGEXP: /^Der Chat wurde von (\w+) \| (\w+) (.+)\./,
    SLOWCHAT_ALERT_REGEXP: /^Du kannst nur jede 3 Sekunden schreiben./,
};
