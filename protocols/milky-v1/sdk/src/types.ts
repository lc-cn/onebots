/**
 * Milky V1 Client Types
 */

export interface MilkyV1ClientConfig {
  /** 服务器地址，例如 http://localhost:6727 */
  baseUrl: string;
  /** 访问令牌 */
  accessToken?: string;
  /** 平台标识，例如 qq */
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

export interface MilkyV1Event {
  post_type: 'message' | 'notice' | 'request' | 'meta_event';
  message_type?: 'private' | 'group';
  notice_type?: string;
  request_type?: string;
  meta_event_type?: string;
  time: number;
  self_id: string | number; // Milky 协议中 self_id 可能是 string 或 number
  message_id?: string;
  user_id?: string | number;
  group_id?: string | number;
  message?: string | any[];
  raw_message?: string;
  sub_type?: string;
  sender?: {
    user_id: string | number;
    nickname?: string;
    avatar?: string;
  };
  [key: string]: any;
}

export interface MilkyV1Response<T = any> {
  status: 'ok' | 'failed';
  retcode: number;
  data?: T;
  message?: string;
}

