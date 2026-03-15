// 导出类型
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { SlackConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const slackSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	token: { type: 'string', required: true, label: 'Bot Token' },
	signing_secret: { type: 'string', label: 'Signing Secret' },
	app_token: { type: 'string', label: 'App Token' },
	socket_mode: { type: 'boolean', label: 'Socket Mode' },
};

AdapterRegistry.registerSchema('slack', slackSchema);

