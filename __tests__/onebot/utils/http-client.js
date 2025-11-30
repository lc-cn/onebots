/**
 * OneBot HTTP 客户端工具
 * 提供符合 OneBot 标准的 HTTP 请求功能
 */

/**
 * 构建完整的 API 路径
 * @param {string} platform - 平台名称
 * @param {string} accountId - 账号 ID
 * @param {string} protocol - 协议名称 (如 'onebot')
 * @param {string} version - 协议版本 (如 'v11', 'v12')
 * @param {string} [action] - 动作名称
 * @returns {string} 完整路径
 */
export function buildPath(platform, accountId, protocol, version, action = '') {
  return `/${platform}/${accountId}/${protocol}/${version}${action ? '/' + action : ''}`;
}

/**
 * 发送 HTTP POST 请求到 OneBot API
 * @param {Object} config - 配置对象
 * @param {string} config.baseUrl - 基础 URL
 * @param {string} config.platform - 平台名称
 * @param {string} config.accountId - 账号 ID
 * @param {string} config.accessToken - 访问令牌 (可选)
 * @param {number} config.timeout - 请求超时时间（毫秒）
 * @param {string} protocol - 协议名称
 * @param {string} version - 协议版本
 * @param {string} action - 动作名称
 * @param {Object} [body={}] - 请求体
 * @returns {Promise<{status: number, data: any, error?: string}>}
 */
export async function httpRequest(config, protocol, version, action, body = {}) {
  const path = buildPath(config.platform, config.accountId, protocol, version, action);
  const url = `${config.baseUrl}${path}`;
  
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
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeout),
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
