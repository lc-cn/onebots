/**
 * OneBot 11 WebSocket Reverse 测试
 * 测试 OneBot 11 的反向 WebSocket 连接功能
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createReverseWsServer, waitForConnections, waitForEvents } from '../../utils/test-server.js';
import { checkServerAvailable } from '../../utils/http-client.js';

// 配置
const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsReversePort: 18081,
  timeout: 10000,
};

let serverAvailable = false;
let wsReverseServer = null;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 WebSocket Reverse 测试');
    console.log(`⚙️  启动 WebSocket Reverse 服务器在端口 ${CONFIG.wsReversePort}`);
    wsReverseServer = await createReverseWsServer(CONFIG.wsReversePort);
  } else {
    console.warn('⚠️  服务器未运行，OneBot V11 WebSocket Reverse 测试将被跳过');
  }
});

afterAll(async () => {
  if (wsReverseServer) {
    await wsReverseServer.close();
    console.log('🔌 WebSocket Reverse 服务器已关闭');
  }
});

describe('OneBot V11 - WebSocket Reverse', () => {
  test('配置说明', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📝 OneBot V11 WebSocket Reverse 测试配置');
    console.log('='.repeat(70));
    console.log('在 config.yaml 中添加以下配置以启用 WebSocket Reverse:');
    console.log('');
    console.log('accounts:');
    console.log('  - platform: dingtalk');
    console.log('    account_id: your_account_id');
    console.log('    protocols:');
    console.log('      onebot:');
    console.log('        v11:');
    console.log(`          ws_reverse: ["ws://localhost:${CONFIG.wsReversePort}"]`);
    console.log('');
    console.log('配置后重启服务器，OneBots 将主动连接到指定的 WebSocket 服务器');
    console.log('='.repeat(70) + '\n');
  });

  test('WebSocket Reverse 服务器启动成功', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    expect(wsReverseServer).toBeDefined();
    expect(wsReverseServer.server).toBeDefined();
    expect(wsReverseServer.events).toBeDefined();
    expect(wsReverseServer.connections).toBeDefined();
  });

  test('等待反向 WebSocket 连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('⏳ 等待 10 秒以接收反向连接...');
    console.log('💡 提示: 需要在 config.yaml 中配置 ws_reverse');
    
    // 等待连接
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    if (wsReverseServer.connections.length > 0) {
      console.log(`✅ 接收到 ${wsReverseServer.connections.length} 个反向连接`);
      
      wsReverseServer.connections.forEach((ws, index) => {
        console.log(`连接 ${index + 1}: ${ws.readyState === 1 ? '已连接' : '未连接'}`);
      });
      
      expect(wsReverseServer.connections.length).toBeGreaterThan(0);
      expect(wsReverseServer.connections[0].readyState).toBe(1); // OPEN
    } else {
      console.log('⚠️  未接收到反向连接');
      console.log('📌 请确保:');
      console.log('   1. 已在 config.yaml 中配置 ws_reverse');
      console.log(`   2. URL 指向 ws://localhost:${CONFIG.wsReversePort}`);
      console.log('   3. 服务器已重启以加载新配置');
    }
  }, 15000);

  test('等待接收事件', async () => {
    if (!serverAvailable || wsReverseServer.connections.length === 0) {
      console.log('⏭️  跳过测试：没有反向连接');
      return;
    }
    
    console.log('⏳ 等待 5 秒以接收事件...');
    
    // 等待事件
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    if (wsReverseServer.events.length > 0) {
      console.log(`✅ 接收到 ${wsReverseServer.events.length} 个事件`);
      
      // 显示前 3 个事件
      wsReverseServer.events.slice(0, 3).forEach((event, index) => {
        console.log(`\n事件 ${index + 1}:`);
        console.log(`  类型: ${event.post_type || event.type}`);
        if (event.meta_event_type) console.log(`  元事件类型: ${event.meta_event_type}`);
        if (event.message_type) console.log(`  消息类型: ${event.message_type}`);
        if (event.notice_type) console.log(`  通知类型: ${event.notice_type}`);
        if (event.request_type) console.log(`  请求类型: ${event.request_type}`);
      });
      
      expect(wsReverseServer.events.length).toBeGreaterThan(0);
    } else {
      console.log('⚠️  未接收到事件（可能是正常的，取决于是否有新事件发生）');
    }
  }, 10000);

  test('发送 API 调用并接收响应', async () => {
    if (!serverAvailable || wsReverseServer.connections.length === 0) {
      console.log('⏭️  跳过测试：没有反向连接');
      return;
    }
    
    const ws = wsReverseServer.connections[0];
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API 调用超时'));
      }, 5000);
      
      ws.once('message', (data) => {
        clearTimeout(timeout);
        
        try {
          const response = JSON.parse(data.toString());
          console.log('✅ 收到 API 响应:', JSON.stringify(response, null, 2));
          
          // OneBot 11 响应格式
          expect(response).toHaveProperty('status');
          expect(['ok', 'failed']).toContain(response.status);
          
          if (response.status === 'ok') {
            expect(response).toHaveProperty('data');
            expect(response.data).toHaveProperty('user_id');
            expect(response.data).toHaveProperty('nickname');
          }
          
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      // 发送 get_login_info API 调用
      const apiCall = {
        action: 'get_login_info',
        params: {},
        echo: 'test_' + Date.now()
      };
      
      console.log('📤 发送 API 调用:', apiCall.action);
      ws.send(JSON.stringify(apiCall));
    });
  });

  test('验证事件格式', async () => {
    if (!serverAvailable || wsReverseServer.events.length === 0) {
      console.log('⏭️  跳过测试：没有接收到事件');
      return;
    }
    
    const event = wsReverseServer.events[0];
    
    // OneBot 11 标准字段
    expect(event).toHaveProperty('time');
    expect(event).toHaveProperty('self_id');
    expect(event).toHaveProperty('post_type');
    
    // 验证时间戳
    expect(typeof event.time).toBe('number');
    expect(event.time).toBeGreaterThan(0);
    
    // 验证 self_id
    expect(typeof event.self_id).toBe('number');
    
    // 验证 post_type
    expect(['message', 'notice', 'request', 'meta_event']).toContain(event.post_type);
  });

  test('验证 meta_event 心跳', async () => {
    if (!serverAvailable || wsReverseServer.events.length === 0) {
      console.log('⏭️  跳过测试：没有接收到事件');
      return;
    }
    
    // 查找心跳事件
    const heartbeatEvent = wsReverseServer.events.find(
      e => e.post_type === 'meta_event' && e.meta_event_type === 'heartbeat'
    );
    
    if (heartbeatEvent) {
      console.log('✅ 找到心跳事件');
      expect(heartbeatEvent).toHaveProperty('interval');
      expect(heartbeatEvent).toHaveProperty('status');
      expect(typeof heartbeatEvent.interval).toBe('number');
    } else {
      console.log('⚠️  未找到心跳事件（可能需要等待更长时间）');
    }
  });
});
