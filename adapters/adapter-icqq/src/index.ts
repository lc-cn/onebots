import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';
import { Platform } from './types.js';

export type { ICQQConfig, ICQQProtocol, Platform } from './types.js';
export * from './adapter.js';

const icqqSchema: Schema = {
	account_id: { type: 'string', required: true, label: 'QQ 号' },
	password: { type: 'string', label: '密码(可选/支持扫码)' },
	protocol: {
		platform: {
			type: 'number',
			default: Platform.AndroidPad,
			label: '登录平台',
			description: '模拟的客户端类型，默认安卓平板 (aPad)',
			choices: [
				{ value: Platform.Android, label: '安卓手机 (Android)' },
				{ value: Platform.AndroidPad, label: '安卓平板 (aPad)' },
				{ value: Platform.AndroidWatch, label: '安卓手表 (Watch)' },
				{ value: Platform.MacOS, label: 'MacOS' },
				{ value: Platform.iPad, label: 'iPad' },
				{ value: Platform.Tim, label: 'Tim' },
			],
			validator: (value) => {
				// 数值枚举会有反向映射，只接受数字取值
				const allowed = Object.values(Platform).filter(
					(v): v is Platform => typeof v === 'number',
				);
				return allowed.includes(value as Platform) ? true : '无效的登录平台';
			},
		},
		ver: { type: 'string', label: 'APK 版本', description: '留空则使用协议内置版本' },
		sign_api_addr: {
			type: 'string',
			label: '签名服务器地址',
			placeholder: 'http://127.0.0.1:8080',
		},
		data_dir: {
			type: 'string',
			default: 'data',
			label: '数据目录',
			description: '相对进程工作目录；默认 data',
			placeholder: 'data',
		},
		// 默认 undefined：不写入空对象 {}，避免污染配置
		log_config: {
			type: 'object',
			label: 'log4js 配置',
			description: '可选；留空则使用 ICQQ 默认日志配置',
			placeholder: '留空表示不配置',
		},
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
