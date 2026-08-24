/**
 * OneBot V12 Client Types
 */

export interface OneBotV12ClientConfig {
  /** 服务器地址，例如 http://localhost:6727 */
  baseUrl: string;
  /** 访问令牌 */
  accessToken?: string;
  /** 平台标识，例如 kook */
  platform: string;
  /** 账号ID */
  accountId: string;
  /** 接收方式：websocket | webhook | sse */
  receiveMode?: 'websocket' | 'webhook' | 'sse';
  /** Webhook 接收地址（当 receiveMode 为 webhook 时使用） */
  webhookUrl?: string;
  /** Webhook 端口（当 receiveMode 为 webhook 时使用） */
  webhookPort?: number;
}

export interface OneBotV12Event {
  id: string;
  time: number;
  type: 'message' | 'notice' | 'request' | 'meta';
  detail_type: string;
  sub_type: string;
  self: {
    platform: string;
    user_id: string;
  };
  user_id?: string;
  message_id?: string;
  message?: unknown[];
  group_id?: string;
  channel_id?: string;
  [key: string]: unknown;
}

export interface OneBotV12Response<T = unknown> {
  status: 'ok' | 'failed';
  retcode: number;
  data?: T;
  message?: string;
}

export interface OneBotV12Segment {
  type: string;
  data?: Record<string, unknown>;
}

export type EventHandler = (event: OneBotV12Event) => void | Promise<void>;

