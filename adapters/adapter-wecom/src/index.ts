// 导出类型
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { WeComConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const wecomSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	corp_id: { type: 'string', required: true, label: '企业 ID' },
	corp_secret: { type: 'string', required: true, label: '应用 Secret' },
	agent_id: { type: 'string', required: true, label: 'AgentId' },
	token: { type: 'string', label: '回调验证 Token' },
	encoding_aes_key: { type: 'string', label: '消息加解密密钥' },
};

AdapterRegistry.registerSchema('wecom', wecomSchema);

