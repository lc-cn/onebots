/**
 * Satori V1 Client Types
 */

export interface SatoriV1ClientConfig {
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

export interface SatoriV1Event {
  id: string;
  type: string;
  platform: string;
  self_id: string;
  timestamp: number;
  channel?: { id: string; [key: string]: unknown };
  guild?: { id: string; [key: string]: unknown };
  user?: { id: string; name?: string; avatar?: string; username?: string; [key: string]: unknown };
  operator?: { id: string; [key: string]: unknown };
  message?: { id: string; content?: string | unknown[]; created_at?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SatoriV1Response<T = unknown> {
  code?: number;
  message?: string;
  data?: T;
}

