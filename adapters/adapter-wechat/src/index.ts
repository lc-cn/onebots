
// 导出类型
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { WechatConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const wechatSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	appId: { type: 'string', required: true, label: 'App ID' },
	appSecret: { type: 'string', required: true, label: 'App Secret' },
	token: { type: 'string', required: true, label: 'Token' },
	encodingAESKey: { type: 'string', label: 'EncodingAESKey' },
	accountType: { type: 'string', enum: ['subscription', 'service'], default: 'subscription', label: '账号类型' },
};

AdapterRegistry.registerSchema('wechat', wechatSchema);
