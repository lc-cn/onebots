
// 导出类型
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { KookConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const kookSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	token: { type: 'string', required: true, label: 'Bot Token' },
	verifyToken: { type: 'string', label: 'Webhook 验证 Token' },
	encryptKey: { type: 'string', label: '消息加密 Key' },
	mode: { type: 'string', enum: ['webhook', 'websocket'], default: 'websocket', label: '连接模式' },
	maxRetry: { type: 'number', default: 10, label: '最大重连次数' },
};

AdapterRegistry.registerSchema('kook', kookSchema);
