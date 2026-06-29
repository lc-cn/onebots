import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

export type { HeychatConfig, ProxyConfig } from './types.js';
export * from './adapter.js';
export * from './bot.js';

const heychatSchema: Schema = {
    account_id: { type: 'string', required: true, label: '账号标识' },
    token: { type: 'string', required: true, label: 'Bot Token' },
    api_base: { type: 'string', default: 'https://chat.xiaoheihe.cn', label: 'API 地址' },
    upload_base: {
        type: 'string',
        default: 'https://chat-upload.xiaoheihe.cn',
        label: '上传 API 地址',
    },
    ws_url: {
        type: 'string',
        default: 'wss://chat.xiaoheihe.cn/chatroom/ws/connect',
        label: 'WebSocket 地址',
    },
    chat_version: { type: 'string', default: '1.30.0', label: '客户端版本' },
    ping_interval: { type: 'number', default: 30, label: '心跳间隔（秒）' },
    ignore_self_messages: { type: 'boolean', default: true, label: '忽略自身消息' },
    proxy: {
        url: { type: 'string', label: '代理地址' },
        username: { type: 'string', label: '代理用户名' },
        password: { type: 'string', label: '代理密码' },
    },
};

AdapterRegistry.registerSchema('heychat', heychatSchema);
