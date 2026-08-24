/**
 * OneBot V11 Client Types
 */

export interface OneBotV11ClientConfig {
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

export interface OneBotV11Event {
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  message_type?: 'private' | 'group';
  notice_type?: string;
  request_type?: string;
  meta_event_type?: string;
  time: number;
  self_id: number;
  user_id?: number;
  message_id?: number;
  group_id?: number;
  message?: unknown[];
  raw_message?: string;
  [key: string]: unknown;
}

export interface OneBotV11Response<T = unknown> {
  status: 'ok' | 'failed';
  retcode: number;
  data?: T;
  message?: string;
  echo?: unknown;
}

export type EventHandler = (event: OneBotV11Event) => void | Promise<void>;

