import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

// 导出类型
export type { DiscordConfig, ProxyConfig, GatewayIntentName, PresenceStatus } from './types.js';
export { ChannelType, MessageType, ActivityType } from './types.js';

// 导出适配器
export * from './adapter.js';

// 导出 Bot
export { DiscordBot } from './bot.js';
export type { DiscordUser, DiscordMessage, DiscordGuild, DiscordChannel, DiscordMember, DiscordAttachment } from './bot.js';

// 导出轻量版客户端（用于独立使用或 Serverless）
export * from './lite/index.js';

const discordSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	token: { type: 'string', required: true, label: 'Bot Token' },
	proxy: {
		url: { type: 'string', label: '代理地址' },
		username: { type: 'string', label: '代理用户名' },
		password: { type: 'string', label: '代理密码' },
	},
	intents: { type: 'array', label: 'Gateway Intents' },
	presence: {
		status: { type: 'string', enum: ['online', 'idle', 'dnd', 'invisible'], label: '状态' },
		activities: { type: 'array', label: '活动列表' },
	},
};

AdapterRegistry.registerSchema('discord', discordSchema);
