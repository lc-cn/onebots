import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

/**
 * Zulip 适配器入口文件
 */
export { ZulipAdapter } from './adapter.js';
export { ZulipBot } from './bot.js';
export type {
    ZulipConfig,
    ZulipMessageEvent,
    ZulipUpdateMessageEvent,
    ZulipDeleteMessageEvent,
    ZulipReactionEvent,
    ZulipHeartbeatEvent,
    ZulipWebSocketEvent,
    ZulipSendMessageParams,
    ZulipAPIResponse,
    ProxyConfig,
} from './types.js';

const zulipSchema: Schema = {
    account_id: { type: 'string', required: true, label: '账号标识' },
    serverUrl: { type: 'string', required: true, label: '服务器地址' },
    email: { type: 'string', required: true, label: '邮箱地址' },
    apiKey: { type: 'string', required: true, label: 'API Key' },
    proxy: {
        url: { type: 'string', label: '代理地址' },
        username: { type: 'string', label: '代理用户名' },
        password: { type: 'string', label: '代理密码' },
    },
    websocket: {
        enabled: { type: 'boolean', default: true, label: '启用 WebSocket' },
        reconnectInterval: { type: 'number', default: 3000, label: '重连间隔(毫秒)' },
        maxReconnectAttempts: { type: 'number', default: 10, label: '最大重连次数' },
    },
};

AdapterRegistry.registerSchema('zulip', zulipSchema);

