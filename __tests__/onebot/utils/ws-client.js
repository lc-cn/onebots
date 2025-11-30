/**
 * OneBot WebSocket 客户端工具
 * 提供符合 OneBot 标准的 WebSocket 连接功能
 */

import { WebSocket } from 'ws';
import { buildPath } from './http-client.js';

/**
 * 创建 WebSocket 连接
 * @param {Object} config - 配置对象
 * @param {string} config.wsUrl - WebSocket 基础 URL
 * @param {string} config.platform - 平台名称
 * @param {string} config.accountId - 账号 ID
 * @param {string} config.accessToken - 访问令牌 (可选)
 * @param {string} protocol - 协议名称
 * @param {string} version - 协议版本
 * @returns {WebSocket}
 */
export function createWebSocket(config, protocol, version) {
  const path = buildPath(config.platform, config.accountId, protocol, version);
  let url = `${config.wsUrl}${path}`;
  
  if (config.accessToken) {
    url += `?access_token=${config.accessToken}`;
  }
  
  return new WebSocket(url);
}

/**
 * 等待 WebSocket 连接建立
 * @param {WebSocket} ws - WebSocket 实例
 * @param {number} [timeout=5000] - 超时时间（毫秒）
 * @returns {Promise<void>}
 */
export function waitForConnection(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket 连接超时'));
    }, timeout);
    
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * 监听 WebSocket 事件
 * @param {string} name - 连接名称（用于日志）
 * @param {WebSocket} ws - WebSocket 实例
 * @param {number} duration - 监听时长（毫秒）
 * @returns {Promise<Array>} 接收到的事件列表
 */
export function monitorWebSocket(name, ws, duration) {
  return new Promise((resolve, reject) => {
    const events = [];
    const startTime = Date.now();
    
    console.log(`[${name}] 连接: ${ws.url}`);
    console.log(`[${name}] 开始监听事件 (${duration}ms)...`);
    
    const timeout = setTimeout(() => {
      console.log(`[${name}] 监听结束，共接收 ${events.length} 个事件`);
      ws.close();
      resolve(events);
    }, duration);
    
    ws.on('open', () => {
      console.log(`[${name}] ✓ WebSocket 连接已建立`);
    });
    
    ws.on('message', (data) => {
      const elapsed = Date.now() - startTime;
      try {
        const message = JSON.parse(data.toString());
        events.push(message);
        console.log(`[${name}] [${elapsed}ms] 收到事件类型:`, message.post_type || message.type || 'unknown');
      } catch (error) {
        console.error(`[${name}] 解析消息失败:`, error.message);
      }
    });
    
    ws.on('error', (error) => {
      console.error(`[${name}] ✗ WebSocket 错误:`, error.message);
      clearTimeout(timeout);
      
      if (error.message.includes('ECONNREFUSED')) {
        console.log(`[${name}] ⚠ 服务器未运行`);
        resolve(events);
      } else {
        reject(error);
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`[${name}] 连接关闭 [code=${code}]`);
      clearTimeout(timeout);
      resolve(events);
    });
  });
}
