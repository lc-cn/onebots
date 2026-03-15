// 导出类型
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { DingTalkConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const dingtalkSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	app_key: { type: 'string', required: true, label: 'AppKey' },
	app_secret: { type: 'string', required: true, label: 'AppSecret' },
	agent_id: { type: 'string', label: 'AgentId' },
	encrypt_key: { type: 'string', label: '事件加密 Key' },
	token: { type: 'string', label: '事件验证 Token' },
	webhook_url: { type: 'string', label: 'Webhook URL' },
};

AdapterRegistry.registerSchema('dingtalk', dingtalkSchema);

