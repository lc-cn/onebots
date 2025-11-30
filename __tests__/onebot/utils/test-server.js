/**
 * 测试服务器工具
 * 用于接收 WebHook 和 WebSocket Reverse 连接
 */

import http from 'http';
import { WebSocketServer } from 'ws';

/**
 * 创建 HTTP 服务器用于接收 WebHook
 * @param {number} port - 端口号
 * @returns {Promise<{server: http.Server, events: Array, close: Function}>}
 */
export function createWebhookServer(port) {
  const events = [];
  
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
            const event = JSON.parse(body);
            events.push(event);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    server.on('error', reject);
    
    server.listen(port, () => {
      resolve({
        server,
        events,
        close: () => new Promise((resolve) => server.close(resolve))
      });
    });
  });
}

/**
 * 创建 WebSocket 服务器用于接收反向 WebSocket 连接
 * @param {number} port - 端口号
 * @returns {Promise<{server: WebSocketServer, events: Array, connections: Array, close: Function}>}
 */
export function createReverseWsServer(port) {
  const events = [];
  const connections = [];
  
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    
    wss.on('error', reject);
    
    wss.on('listening', () => {
      resolve({
        server: wss,
        events,
        connections,
        close: () => new Promise((resolve) => {
          connections.forEach(ws => ws.close());
          wss.close(resolve);
        })
      });
    });
    
    wss.on('connection', (ws, req) => {
      connections.push(ws);
      
      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          events.push(event);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket connection error:', error);
      });
    });
  });
}

/**
 * 等待指定数量的事件
 * @param {Array} events - 事件数组
 * @param {number} count - 期望的事件数量
 * @param {number} [timeout=5000] - 超时时间（毫秒）
 * @returns {Promise<void>}
 */
export function waitForEvents(events, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkEvents = () => {
      if (events.length >= count) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout: expected ${count} events, got ${events.length}`));
      } else {
        setTimeout(checkEvents, 100);
      }
    };
    
    checkEvents();
  });
}

/**
 * 等待 WebSocket 连接
 * @param {Array} connections - 连接数组
 * @param {number} count - 期望的连接数量
 * @param {number} [timeout=5000] - 超时时间（毫秒）
 * @returns {Promise<void>}
 */
export function waitForConnections(connections, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkConnections = () => {
      if (connections.length >= count) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout: expected ${count} connections, got ${connections.length}`));
      } else {
        setTimeout(checkConnections, 100);
      }
    };
    
    checkConnections();
  });
}
