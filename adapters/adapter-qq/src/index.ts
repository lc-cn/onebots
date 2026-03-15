import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

// 导出类型
export type { QQConfig, QQIntent, QQUser, QQGuild, QQChannel, QQMember, QQMessage, ReceiverMode } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const qqSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	appId: { type: 'string', required: true, label: 'App ID' },
	secret: { type: 'string', required: true, label: 'App Secret' },
	token: { type: 'string', label: '验证 Token' },
	sandbox: { type: 'boolean', label: '沙箱模式' },
	intents: { type: 'array', label: '订阅事件' },
	removeAt: { type: 'boolean', label: '移除 @' },
	maxRetry: { type: 'number', label: '最大重试次数' },
	logLevel: { type: 'string', label: '日志等级' },
	mode: { type: 'string', enum: ['websocket', 'webhook'], default: 'websocket', label: '接收模式' },
};

AdapterRegistry.registerSchema('qq', qqSchema);
