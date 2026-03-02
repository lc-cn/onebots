/**
 * 邮件适配器入口文件
 */
export { EmailAdapter } from './adapter.js';
export { EmailBot } from './bot.js';
import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { EmailConfig, SMTPConfig, IMAPConfig, EmailMessage, ProxyConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const emailSchema: Schema = {
	account_id: { type: 'string', required: true, label: '账号标识' },
	from: { type: 'string', required: true, label: '发件人邮箱' },
	fromName: { type: 'string', label: '发件人名称' },
	smtp: {
		host: { type: 'string', required: true, label: 'SMTP 主机' },
		port: { type: 'number', default: 587, label: 'SMTP 端口' },
		secure: { type: 'boolean', default: true, label: 'TLS' },
		requireTLS: { type: 'boolean', default: true, label: 'STARTTLS' },
		user: { type: 'string', required: true, label: 'SMTP 用户名' },
		password: { type: 'string', required: true, label: 'SMTP 密码' },
		proxy: {
			url: { type: 'string', label: '代理地址' },
			username: { type: 'string', label: '代理用户名' },
			password: { type: 'string', label: '代理密码' },
		},
	},
	imap: {
		host: { type: 'string', required: true, label: 'IMAP 主机' },
		port: { type: 'number', default: 993, label: 'IMAP 端口' },
		tls: { type: 'boolean', default: true, label: 'TLS' },
		user: { type: 'string', required: true, label: 'IMAP 用户名' },
		password: { type: 'string', required: true, label: 'IMAP 密码' },
		proxy: {
			url: { type: 'string', label: '代理地址' },
			username: { type: 'string', label: '代理用户名' },
			password: { type: 'string', label: '代理密码' },
		},
		pollInterval: { type: 'number', default: 30000, label: '轮询间隔(毫秒)' },
		mailbox: { type: 'string', default: 'INBOX', label: '邮箱文件夹' },
	},
};

AdapterRegistry.registerSchema('email', emailSchema);

