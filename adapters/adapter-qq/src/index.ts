import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

// 导出类型
export type { QQConfig, QQIntent, ReceiverMode } from './types.js';
export type { Intent, MessageElem, Sendable } from 'qq-official-bot';
export * from './adapter.js';

const qqSchema: Schema = {
    account_id: { type: 'string', required: true, label: '账号标识' },
    appid: { type: 'string', required: true, label: 'App ID' },
    secret: { type: 'string', required: true, label: 'App Secret' },
    sandbox: { type: 'boolean', label: '沙箱模式' },
    intents: { type: 'array', label: '订阅事件' },
    mode: {
        type: 'string',
        default: 'websocket',
        label: '接收模式',
        choices: [
            { value: 'websocket', label: 'WebSocket' },
            { value: 'webhook', label: 'Webhook' },
        ],
    },
    apiBaseUrl: { type: 'string', label: '自定义 API 根地址（高级）' },
    port: { type: 'number', label: 'Webhook 监听端口（webhook 模式必填）' },
    path: { type: 'string', label: 'Webhook 路径', default: '/' },
};

AdapterRegistry.registerSchema('qq', qqSchema);