import { MilkyV1Response } from './types.js';

export interface HttpClientConfig {
  baseUrl: string;
  accessToken?: string;
  platform: string;
  accountId: string;
}

/**
 * HTTP 客户端，用于发送 API 请求
 */
export class HttpClient {
  private config: HttpClientConfig;
  private basePath: string;

  constructor(config: HttpClientConfig) {
    this.config = config;
    this.basePath = `/${config.platform}/${config.accountId}/milky/v1`;
  }

  /**
   * 发送 POST 请求
   */
  async post(action: string, params?: Record<string, unknown>): Promise<MilkyV1Response> {
    const url = `${this.config.baseUrl}${this.basePath}/${action}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.accessToken) {
      headers['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params || {}),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json() as Promise<MilkyV1Response>;
  }
}

