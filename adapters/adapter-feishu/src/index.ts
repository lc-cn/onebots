// 导出类型和常量
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export { FeishuEndpoint, type FeishuConfig, type FeishuEndpointType } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const feishuSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	app_id: { type: 'string', required: true, label: 'App ID' },
	app_secret: { type: 'string', required: true, label: 'App Secret' },
	encrypt_key: { type: 'string', label: '事件加密 Key' },
	verification_token: { type: 'string', label: '事件验证 Token' },
	endpoint: { type: 'string', label: 'API 端点' },
};

AdapterRegistry.registerSchema('feishu', feishuSchema);

