import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { ICQQConfig, ICQQProtocol, Platform } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const icqqSchema: Schema = {
	account_id: { type: 'string', required: true, label: 'QQ 号' },
	password: { type: 'string', label: '密码(可选/支持扫码)' },
	protocol: {
		platform: { type: 'number', enum: [1, 2, 3, 4, 5, 6], default: 2, label: '登录平台' },
		ver: { type: 'string', label: 'APK 版本' },
		sign_api_addr: { type: 'string', label: '签名服务器地址' },
		data_dir: { type: 'string', label: '数据目录' },
		log_config: { type: 'object', label: 'log4js 配置' },
		ignore_self: { type: 'boolean', default: true, label: '过滤自己消息' },
		resend: { type: 'boolean', default: true, label: '风控分片发送' },
		reconn_interval: { type: 'number', default: 5, label: '重连间隔(秒)' },
		cache_group_member: { type: 'boolean', default: true, label: '缓存群员列表' },
		auto_server: { type: 'boolean', default: true, label: '自动选择服务器' },
		ffmpeg_path: { type: 'string', label: 'ffmpeg 路径' },
		ffprobe_path: { type: 'string', label: 'ffprobe 路径' },
	},
};

AdapterRegistry.registerSchema('icqq', icqqSchema);

