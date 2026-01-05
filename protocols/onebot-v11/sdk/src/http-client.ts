import { OneBotV11Response } from './types.js';

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
    // baseUrl 格式: http://localhost:6727
    // API 路径需要构建为: /{platform}/{accountId}/onebot/v11/{action}
    const url = new URL(config.baseUrl);
    // 从 baseUrl 解析路径，如果没有路径则使用配置的 platform 和 accountId
    if (url.pathname && url.pathname !== '/') {
      this.basePath = url.pathname; // 例如: /kook/zhin/onebot/v11
    } else {
      // 如果没有路径，需要从 platform 和 accountId 构建
      this.basePath = `/${config.platform}/${config.accountId}/onebot/v11`;
    }
  }

  /**
   * 发送 POST 请求
   */
  async post(action: string, params?: any): Promise<OneBotV11Response> {
    // 确保 action 不以 / 开头
    const actionPath = action.startsWith('/') ? action.substring(1) : action;
    
    // 构建完整 URL，确保 baseUrl 和 basePath 正确拼接
    const baseUrl = this.config.baseUrl.replace(/\/$/, ''); // 移除末尾的斜杠
    const basePath = this.basePath.startsWith('/') ? this.basePath : `/${this.basePath}`; // 确保以 / 开头
    const fullPath = `${basePath}/${actionPath}`.replace(/\/+/g, '/'); // 移除重复的斜杠
    
    const urlObj = new URL(fullPath, baseUrl);
    
    // OneBot V11 支持两种方式传递 access_token：
    // 1. URL query parameter: ?access_token=xxx
    // 2. Authorization header: Bearer xxx
    // 优先使用 query parameter（更符合 OneBot 标准）
    if (this.config.accessToken) {
      urlObj.searchParams.set('access_token', this.config.accessToken);
    }
    
    const url = urlObj.toString();
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 同时也在 header 中传递（作为备选）
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

    return response.json() as Promise<OneBotV11Response>;
  }
}

