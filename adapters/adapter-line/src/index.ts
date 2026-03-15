import { AdapterRegistry } from 'onebots';
import type { Schema } from 'onebots';

// 导出类型
export type { LineConfig, ProxyConfig } from './types.js';
export type {
    WebhookEvent,
    MessageEvent,
    FollowEvent,
    UnfollowEvent,
    JoinEvent,
    LeaveEvent,
    MemberJoinedEvent,
    MemberLeftEvent,
    PostbackEvent,
    Message,
    TextMessage,
    ImageMessage,
    VideoMessage,
    AudioMessage,
    FileMessage,
    LocationMessage,
    StickerMessage,
    SendMessage,
    UserProfile,
    GroupSummary,
    GroupMemberProfile,
} from './types.js';

// 导出适配器
export * from './adapter.js';

// 导出 Bot
export { LineBot } from './bot.js';

const lineSchema: Schema = {
    account_id: { type: 'string', required: true, label: '账号标识' },
    channel_access_token: { type: 'string', required: true, label: 'Channel Access Token' },
    channel_secret: { type: 'string', required: true, label: 'Channel Secret' },
    proxy: {
        url: { type: 'string', label: '代理地址' },
        username: { type: 'string', label: '代理用户名' },
        password: { type: 'string', label: '代理密码' },
    },
};

AdapterRegistry.registerSchema('line', lineSchema);

