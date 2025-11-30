/**
 * Milky 协议 HTTP 客户端工具
 * 参考: https://milky.ntqqrev.org/guide/communication
 */

/**
 * 调用 Milky API
 * @param {Object} config - 配置对象
 * @param {string} config.baseUrl - 基础 URL
 * @param {string} config.platform - 平台名称
 * @param {string} config.accountId - 账号 ID
 * @param {string} config.accessToken - 访问令牌 (可选)
 * @param {number} config.timeout - 请求超时时间（毫秒）
 * @param {string} api - API 名称
 * @param {Object} [params={}] - 请求参数
 * @returns {Promise<{status: number, data: any, error?: string}>}
 */
export async function callMilkyAPI(config, api, params = {}) {
  const url = `${config.baseUrl}/${config.platform}/${config.accountId}/milky/v1/api/${api}`;
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (config.accessToken) {
    headers['Authorization'] = `Bearer ${config.accessToken}`;
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(config.timeout || 5000),
    });
    
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { 
      status: 0, 
      error: error.message,
      data: null 
    };
  }
}

/**
 * 检查服务器是否可用
 * @param {string} baseUrl - 服务器基础 URL
 * @param {number} [timeout=3000] - 超时时间（毫秒）
 * @returns {Promise<boolean>}
 */
export async function checkServerAvailable(baseUrl, timeout = 3000) {
  try {
    const response = await fetch(`${baseUrl}/list`, {
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok || response.status === 401;
  } catch (error) {
    return false;
  }
}
