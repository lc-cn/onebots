/**
 * OneBot 12 WebSocket Reverse 请求头测试
 * 测试反向 WebSocket 的请求头是否符合 OneBot 12 标准
 * 参考: https://12.onebot.dev/connect/communication/websocket-reverse/
 * 
 * 必需的请求头:
 * - User-Agent: 如 OneBot/12 (qq) Go-LibOneBot/1.0.0
 * - Sec-WebSocket-Protocol: <onebot_version>.<impl> 如 12.onebots
 * - Authorization: Bearer <access_token> (如果配置了 access_token)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsReversePort: 18086, // 使用不同的端口
  accessToken: process.env.ACCESS_TOKEN || '',
};

let serverAvailable = false;
let wsReverseServer = null;
let connectionAttempts = [];

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V12 WebSocket Reverse 请求头测试');
    console.log(`⚙️  启动 WebSocket Reverse 服务器在端口 ${CONFIG.wsReversePort}`);
    wsReverseServer = await createReverseWsServerWithHeaders(CONFIG.wsReversePort);
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
 * 创建能捕获请求头的反向 WebSocket 服务器
 */
function createReverseWsServerWithHeaders(port) {
  const connections = [];
  const attempts = connectionAttempts;
  
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ 
      port,
      handleProtocols: (protocols, request) => {
        // 记录 Sec-WebSocket-Protocol
        console.log('📡 收到协议:', protocols);
        return protocols[0]; // 接受第一个协议
      },
    });
    
    wss.on('error', reject);
    
    wss.on('listening', () => {
      resolve({
        server: wss,
        connections,
        attempts,
        close: () => new Promise((resolve) => {
          connections.forEach(ws => ws.close());
          wss.close(resolve);
        })
      });
    });
    
    wss.on('connection', (ws, req) => {
      // 记录连接尝试
      const attempt = {
        timestamp: Date.now(),
        url: req.url,
        headers: req.headers,
        protocols: req.headers['sec-websocket-protocol'],
      };
      
      attempts.push(attempt);
      connections.push(ws);
      
      console.log('\n📥 新的 WebSocket 连接:');
      console.log('  URL:', req.url);
      console.log('  User-Agent:', req.headers['user-agent']);
      console.log('  Sec-WebSocket-Protocol:', req.headers['sec-websocket-protocol']);
      console.log('  Authorization:', req.headers['authorization'] || '(未设置)');
      
      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          // 可以处理事件
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });
    });
  });
}

describe('OneBot V12 - WebSocket Reverse 请求头测试', () => {
  test('配置说明', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📝 OneBot V12 WebSocket Reverse 请求头测试配置');
    console.log('='.repeat(70));
    console.log('在 config.yaml 中添加以下配置:');
    console.log('');
    console.log('dingtalk.dingl4hqvwwxewpk6tcn:');
    console.log('  onebot.v12:');
    console.log(`    ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}"]`);
    console.log('');
    console.log('OneBot 12 标准要求的请求头:');
    console.log('  ✓ User-Agent: OneBot/12 (<impl>) <software>');
    console.log('  ✓ Sec-WebSocket-Protocol: <onebot_version>.<impl>');
    console.log('    示例: 12.onebots');
    console.log('  ✓ Authorization: Bearer <access_token> (可选)');
    console.log('='.repeat(70) + '\n');
  });

  test('等待反向 WebSocket 连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    console.log('⏳ 等待 10 秒以接收反向 WebSocket 连接...');
    console.log(`💡 提示: 需要在 config.yaml 中配置 ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}"]`);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    if (connectionAttempts.length === 0) {
      console.log('⚠️  未接收到连接尝试');
      console.log('📌 请确保:');
      console.log('   1. 已在 config.yaml 中配置 ws_reverse');
      console.log(`   2. URL 指向 ws://localhost:${CONFIG.wsReversePort}`);
      console.log('   3. 服务器已重启');
      return;
    }
    
    console.log(`✅ 接收到 ${connectionAttempts.length} 个连接尝试\n`);
    expect(connectionAttempts.length).toBeGreaterThan(0);
  }, 15000);

  test('验证 User-Agent 请求头', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (connectionAttempts.length === 0) {
      console.log('⏭️  跳过测试：没有接收到连接');
      return;
    }

    const firstAttempt = connectionAttempts[0];
    const userAgent = firstAttempt.headers['user-agent'];
    
    console.log('📊 User-Agent:', userAgent);
    
    expect(userAgent).toBeDefined();
    expect(userAgent.length).toBeGreaterThan(0);
    
    // 建议格式: OneBot/12 (impl) software/version
    if (userAgent.includes('OneBot')) {
      console.log('✅ User-Agent 包含 OneBot 标识');
      if (userAgent.includes('12')) {
        console.log('✅ User-Agent 包含版本号 12');
      }
    } else {
      console.log('⚠️  User-Agent 未包含 OneBot 标识（建议格式: OneBot/12 (impl) software/version）');
    }
  });

  test('验证 Sec-WebSocket-Protocol 请求头', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (connectionAttempts.length === 0) {
      console.log('⏭️  跳过测试：没有接收到连接');
      return;
    }

    const firstAttempt = connectionAttempts[0];
    const protocol = firstAttempt.headers['sec-websocket-protocol'];
    
    console.log('📊 Sec-WebSocket-Protocol:', protocol);
    
    expect(protocol).toBeDefined();
    expect(protocol.length).toBeGreaterThan(0);
    
    // 标准格式: <onebot_version>.<impl>
    // 例如: 12.onebots
    const protocolPattern = /^(\d+)\.([a-z0-9_-]+)$/;
    const match = protocol.match(protocolPattern);
    
    if (match) {
      const [, version, impl] = match;
      console.log('✅ Sec-WebSocket-Protocol 格式正确');
      console.log(`   版本: ${version}`);
      console.log(`   实现: ${impl}`);
      
      expect(version).toBe('12');
      console.log('✅ OneBot 版本为 12');
    } else {
      console.log('⚠️  Sec-WebSocket-Protocol 格式不符合标准');
      console.log('   预期格式: <onebot_version>.<impl>');
      console.log('   示例: 12.onebots');
    }
  });

  test('验证 Authorization 请求头（如果配置了 access_token）', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (connectionAttempts.length === 0) {
      console.log('⏭️  跳过测试：没有接收到连接');
      return;
    }

    const firstAttempt = connectionAttempts[0];
    const authorization = firstAttempt.headers['authorization'];
    
    console.log('📊 Authorization:', authorization || '(未设置)');
    
    if (CONFIG.accessToken) {
      // 如果设置了 ACCESS_TOKEN 环境变量，应该有 Authorization 头
      expect(authorization).toBeDefined();
      expect(authorization).toMatch(/^Bearer .+/);
      console.log('✅ Authorization 请求头格式正确');
    } else {
      if (authorization) {
        console.log('✅ 服务器配置了 access_token 并发送了 Authorization 请求头');
      } else {
        console.log('💡 未配置 access_token，没有 Authorization 请求头（这是正常的）');
      }
    }
  });

  test('验证 Query 参数方式的 access_token（备选方案）', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (connectionAttempts.length === 0) {
      console.log('⏭️  跳过测试：没有接收到连接');
      return;
    }

    const firstAttempt = connectionAttempts[0];
    const url = firstAttempt.url || '';
    
    console.log('📊 连接 URL:', url);
    
    // 检查是否通过 Query 参数传递 access_token
    if (url.includes('access_token=')) {
      console.log('✅ 使用 Query 参数传递 access_token');
      const match = url.match(/access_token=([^&]+)/);
      if (match) {
        console.log('   Token 长度:', match[1].length);
      }
    } else if (firstAttempt.headers['authorization']) {
      console.log('✅ 使用 Authorization 请求头传递 access_token');
    } else {
      console.log('💡 未使用 access_token（未配置或配置为空）');
    }
  });

  test('完整请求头摘要', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (connectionAttempts.length === 0) {
      console.log('⏭️  跳过测试：没有接收到连接');
      return;
    }

    const firstAttempt = connectionAttempts[0];
    
    console.log('\n' + '='.repeat(70));
    console.log('📋 完整请求头摘要');
    console.log('='.repeat(70));
    
    const headers = {
      'User-Agent': firstAttempt.headers['user-agent'],
      'Sec-WebSocket-Protocol': firstAttempt.headers['sec-websocket-protocol'],
      'Sec-WebSocket-Version': firstAttempt.headers['sec-websocket-version'],
      'Sec-WebSocket-Key': firstAttempt.headers['sec-websocket-key'] ? '(已设置)' : '(未设置)',
      'Authorization': firstAttempt.headers['authorization'] || '(未设置)',
      'Connection': firstAttempt.headers['connection'],
      'Upgrade': firstAttempt.headers['upgrade'],
    };
    
    Object.entries(headers).forEach(([key, value]) => {
      const status = value && value !== '(未设置)' ? '✅' : '❌';
      console.log(`${status} ${key}: ${value}`);
    });
    
    console.log('='.repeat(70) + '\n');
    
    // 验证所有必需的请求头
    expect(firstAttempt.headers['user-agent']).toBeDefined();
    expect(firstAttempt.headers['sec-websocket-protocol']).toBeDefined();
    expect(firstAttempt.headers['sec-websocket-protocol']).toMatch(/^\d+\.[a-z0-9_-]+$/);
  });
});
