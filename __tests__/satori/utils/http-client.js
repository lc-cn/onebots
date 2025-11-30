/**
 * Satori Protocol HTTP Client Utilities
 * Reference: https://satori.chat/zh-CN/protocol/
 */

/**
 * Check if Satori server is available
 */
export async function checkServerAvailable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/v1`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok || response.status === 404; // 404 also means server is running
  } catch (error) {
    return false;
  }
}

/**
 * Call Satori API
 * @param {Object} config - Configuration
 * @param {string} method - API method name (e.g., 'message.create')
 * @param {Object} params - Method parameters
 * @returns {Promise<{status: number, data: any}>}
 */
export async function callSatoriAPI(config, method, params = {}) {
  const url = `${config.baseUrl}/${config.platform}/${config.accountId}/satori/v1/${method}`;
  
  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });

    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

/**
 * Create WebSocket connection for Satori
 */
export function createSatoriWebSocket(config) {
  const { WebSocket } = require('ws');
  const url = `${config.wsUrl}/${config.platform}/${config.accountId}/satori/v1/events`;
  
  const headers = {};
  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  return new WebSocket(url, { headers });
}
