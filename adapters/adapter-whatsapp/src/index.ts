import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export { WhatsAppAdapter } from './adapter.js';
export { WhatsAppBot } from './bot.js';
export type {
    WhatsAppConfig,
    WhatsAppMessageEvent,
    WhatsAppWebhookEvent,
    WhatsAppSendMessageParams,
    WhatsAppAPIResponse,
    ProxyConfig,
} from './types.js';

const whatsappSchema: Schema = {
    account_id: { type: 'string', required: true, label: '账号标识' },
    businessAccountId: { type: 'string', required: true, label: 'Business Account ID' },
    phoneNumberId: { type: 'string', required: true, label: 'Phone Number ID' },
    accessToken: { type: 'string', required: true, label: 'Access Token' },
    webhookVerifyToken: { type: 'string', required: true, label: 'Webhook 验证令牌' },
    apiVersion: { type: 'string', default: 'v21.0', label: 'API 版本' },
    proxy: {
        url: { type: 'string', label: '代理地址' },
        username: { type: 'string', label: '代理用户名' },
        password: { type: 'string', label: '代理密码' },
    },
    webhook: {
        url: { type: 'string', label: 'Webhook URL' },
        fields: { type: 'array', label: '订阅字段' },
    },
};

AdapterRegistry.registerSchema('whatsapp', whatsappSchema);

