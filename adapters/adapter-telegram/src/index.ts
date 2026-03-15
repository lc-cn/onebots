// 导出类型
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { TelegramConfig, ProxyConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const telegramSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	token: { type: 'string', required: true, label: 'Bot Token' },
	proxy: {
		url: { type: 'string', label: '代理地址' },
		username: { type: 'string', label: '代理用户名' },
		password: { type: 'string', label: '代理密码' },
	},
	webhook: {
		url: { type: 'string', label: 'Webhook URL' },
		secret_token: { type: 'string', label: 'Webhook 密钥' },
		allowed_updates: { type: 'array', label: '允许的更新类型' },
	},
	polling: {
		enabled: { type: 'boolean', label: '启用轮询' },
		timeout: { type: 'number', label: '轮询超时(秒)' },
		limit: { type: 'number', label: '更新数量限制' },
		allowed_updates: { type: 'array', label: '允许的更新类型' },
	},
};

AdapterRegistry.registerSchema('telegram', telegramSchema);

