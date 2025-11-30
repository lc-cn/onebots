/**
 * OneBot 11 WebSocket Reverse 鉴权测试
 * 测试反向 WebSocket 的 access_token 鉴权机制
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createReverseWsServerWithAuth } from '../../utils/test-server.js';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsReversePort: 18084, // 使用不同的端口避免冲突
  accessToken: process.env.ACCESS_TOKEN || '',
};

let serverAvailable = false;
let wsReverseServer = null;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 WebSocket Reverse 鉴权测试');
    console.log(`⚙️  启动 WebSocket Reverse 服务器在端口 ${CONFIG.wsReversePort}`);
    wsReverseServer = await createReverseWsServerWithAuth(CONFIG.wsReversePort, CONFIG.accessToken);
  } else {
    console.warn('⚠️  服务器未运行，测试将被跳过');
  }
});

afterAll(async () => {
  if (wsReverseServer) {
    await wsReverseServer.close();
    console.log('🔌 WebSocket Reverse 服务器已关闭');
  }
});

/**
 * 创建支持鉴权的反向 WebSocket 服务器
 */
function createReverseWsServerWithAuth(port, expectedToken) {
  const events = [];
  const connections = [];
  const connectionAttempts = [];
  
  return new Promise((resolve, reject) => {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ 
      port,
      verifyClient: (info, callback) => {
        // 记录连接尝试
        const url = new URL(info.req.url, 'ws://localhost');
        const token = url.searchParams.get('access_token') || info.req.headers['authorization']?.replace('Bearer ', '');
        
        connectionAttempts.push({
          timestamp: Date.now(),
          url: info.req.url,
          headers: info.req.headers,
          token,
          authorized: !expectedToken || token === expectedToken,
        });
        
        // 如果设置了 expectedToken，则验证
        if (expectedToken && token !== expectedToken) {
          console.log('❌ 拒绝连接: token 不匹配');
          console.log('   预期:', expectedToken);
          console.log('   实际:', token);
          callback(false, 401, 'Unauthorized');
          return;
        }
        
        console.log('✅ 接受连接:', token ? '有 token' : '无 token');
        callback(true);
      }
    });
    
    wss.on('error', reject);
    
    wss.on('listening', () => {
      resolve({
        server: wss,
        events,
        connections,
        connectionAttempts,
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
    });
  });
}

describe('OneBot V11 - WebSocket Reverse 鉴权测试', () => {
  test('配置说明', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📝 OneBot V11 WebSocket Reverse 鉴权测试配置');
    console.log('='.repeat(70));
    console.log('测试两种鉴权方式:');
    console.log('');
    console.log('1. Query 参数方式:');
    console.log(`   ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}?access_token=YOUR_TOKEN"]`);
    console.log('');
    console.log('2. Authorization Header 方式 (WebSocket 升级时):');
    console.log(`   ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}"]`);
    console.log('   需要在 WebSocket 握手时发送 Authorization: Bearer YOUR_TOKEN');
    console.log('='.repeat(70) + '\n');
  });

  test('记录连接尝试', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    console.log('⏳ 等待 10 秒以接收反向连接...');
    console.log(`💡 提示: 需要在 config.yaml 中配置 ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}"]`);
    
    if (CONFIG.accessToken) {
      console.log(`   或使用: ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}?access_token=${CONFIG.accessToken}"]`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log(`\n📊 连接尝试统计: ${wsReverseServer.connectionAttempts.length} 次`);
    
    wsReverseServer.connectionAttempts.forEach((attempt, index) => {
      console.log(`\n连接尝试 ${index + 1}:`);
      console.log('  URL:', attempt.url);
      console.log('  Token:', attempt.token || '(无)');
      console.log('  授权:', attempt.authorized ? '✅ 成功' : '❌ 失败');
    });
    
    console.log(`\n✅ 成功建立的连接: ${wsReverseServer.connections.length} 个`);
  }, 15000);

  test('验证鉴权结果', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (wsReverseServer.connectionAttempts.length === 0) {
      console.log('⚠️  未检测到连接尝试');
      console.log('📌 请确保:');
      console.log('   1. 已在 config.yaml 中配置 ws_reverse');
      console.log(`   2. URL 指向 ws://localhost:${CONFIG.wsReversePort}`);
      console.log('   3. 服务器已重启');
      return;
    }

    // 如果设置了 expectedToken，检查是否正确验证
    if (CONFIG.accessToken) {
      const authorizedAttempts = wsReverseServer.connectionAttempts.filter(a => a.authorized);
      const unauthorizedAttempts = wsReverseServer.connectionAttempts.filter(a => !a.authorized);
      
      console.log('\n📊 鉴权统计:');
      console.log('  授权成功:', authorizedAttempts.length, '次');
      console.log('  授权失败:', unauthorizedAttempts.length, '次');
      
      if (authorizedAttempts.length > 0) {
        console.log('✅ 至少有一次成功的授权连接');
        expect(wsReverseServer.connections.length).toBeGreaterThan(0);
      }
    } else {
      console.log('💡 未设置 ACCESS_TOKEN，无法测试鉴权');
      console.log('   提示: 设置环境变量 ACCESS_TOKEN 来测试鉴权功能');
    }
  });
});
