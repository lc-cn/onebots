import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { MockConfig, MockUser, MockGroup, MockMember, MockMessage, MockEvent } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const mockSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	nickname: { type: 'string', label: '用户名' },
	avatar: { type: 'string', label: '头像 URL' },
	auto_events: { type: 'boolean', label: '自动生成事件' },
	event_interval: { type: 'number', label: '事件间隔(毫秒)' },
	latency: { type: 'number', label: '模拟延迟(毫秒)' },
	friends: { type: 'array', label: '预定义好友列表' },
	groups: { type: 'array', label: '预定义群组列表' },
};

AdapterRegistry.registerSchema('mock', mockSchema);

