import type { Intent as SdkIntent } from 'qq-official-bot';

/**
 * QQ 官方机器人适配器 — 配置类型
 * 运行时事件/API 类型均直接复用 `qq-official-bot` SDK
 */
export type ReceiverMode = 'websocket' | 'webhook';

/**
 * 允许用户同时写 SDK 新名与历史旧名。
 * - 新名：直接透传给 SDK
 * - 旧名：在 mapIntents() 中转换并打印一次性弃用警告
 */
export type QQLegacyIntent =
    | 'GROUP_AT_MESSAGE_CREATE'
    | 'C2C_MESSAGE_CREATE'
    | 'OPEN_FORUMS_EVENT';

export type QQIntent = SdkIntent | QQLegacyIntent;

export interface QQConfig {
    account_id: string;
    /** QQ 机器人 AppID（注意：原字段 `appId` 在 v4 中已重命名为 `appid`） */
    appid: string;
    secret: string;
    /** 沙箱模式，映射到 SDK `apiBaseUrl: 'https://sandbox.api.sgroup.qq.com'` */
    sandbox?: boolean;
    intents?: QQIntent[];
    /** 'websocket'（默认）或 'webhook' */
    mode?: ReceiverMode;
    /** 自定义 API 根地址（高级），优先级高于 `sandbox` */
    apiBaseUrl?: string;
    /** Webhook 模式必填：监听端口（与 onebots 主端口区分） */
    port?: number;
    /** Webhook 路径，默认 '/' */
    path?: string;
}