/**
 * OneBot 11 HTTP Reverse (WebHook) 测试
 * 测试 OneBot 11 的 HTTP POST 推送功能
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createWebhookServer, waitForEvents } from '../../utils/test-server.js';
import { checkServerAvailable } from '../../utils/http-client.js';

// 配置
const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  webhookPort: 18080,
  timeout: 10000,
};

let serverAvailable = false;
let webhookServer = null;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 WebHook 测试');
    console.log(`⚙️  启动 WebHook 服务器在端口 ${CONFIG.webhookPort}`);
    webhookServer = await createWebhookServer(CONFIG.webhookPort);
  } else {
    console.warn('⚠️  服务器未运行，OneBot V11 WebHook 测试将被跳过');
  }
});

afterAll(async () => {
  if (webhookServer) {
    await webhookServer.close();
    console.log('🔌 WebHook 服务器已关闭');
  }
});

describe('OneBot V11 - HTTP Reverse (WebHook)', () => {
  test('配置说明', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📝 OneBot V11 HTTP Reverse (WebHook) 测试配置');
    console.log('='.repeat(70));
    console.log('在 config.yaml 中添加以下配置以启用 HTTP Reverse:');
    console.log('');
    console.log('accounts:');
    console.log('  - platform: dingtalk');
    console.log('    account_id: your_account_id');
    console.log('    protocols:');
    console.log('      onebot:');
    console.log('        v11:');
    console.log(`          http_reverse: ["http://localhost:${CONFIG.webhookPort}"]`);
    console.log('');
    console.log('配置后重启服务器，事件将通过 HTTP POST 推送到指定 URL');
    console.log('='.repeat(70) + '\n');
  });

  test('WebHook 服务器启动成功', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    expect(webhookServer).toBeDefined();
    expect(webhookServer.server).toBeDefined();
    expect(webhookServer.events).toBeDefined();
  });

  test('等待接收事件', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('⏳ 等待 10 秒以接收事件...');
    console.log('💡 提示: 需要在 config.yaml 中配置 http_reverse');
    
    // 等待一段时间看是否有事件推送
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    if (webhookServer.events.length > 0) {
      console.log(`✅ 接收到 ${webhookServer.events.length} 个事件`);
      
      // 显示前 3 个事件
      webhookServer.events.slice(0, 3).forEach((event, index) => {
        console.log(`\n事件 ${index + 1}:`);
        console.log(`  类型: ${event.post_type || event.type}`);
        if (event.meta_event_type) console.log(`  元事件类型: ${event.meta_event_type}`);
        if (event.message_type) console.log(`  消息类型: ${event.message_type}`);
        if (event.notice_type) console.log(`  通知类型: ${event.notice_type}`);
        if (event.request_type) console.log(`  请求类型: ${event.request_type}`);
      });
      
      // 验证事件格式
      expect(webhookServer.events[0]).toHaveProperty('time');
      expect(webhookServer.events[0]).toHaveProperty('self_id');
      expect(webhookServer.events[0]).toHaveProperty('post_type');
    } else {
      console.log('⚠️  未接收到事件');
      console.log('📌 请确保:');
      console.log('   1. 已在 config.yaml 中配置 http_reverse');
      console.log(`   2. URL 指向 http://localhost:${CONFIG.webhookPort}`);
      console.log('   3. 服务器已重启以加载新配置');
    }
  }, 15000);

  test('验证事件推送格式', async () => {
    if (!serverAvailable || webhookServer.events.length === 0) {
      console.log('⏭️  跳过测试：没有接收到事件');
      return;
    }
    
    const event = webhookServer.events[0];
    
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
    if (!serverAvailable || webhookServer.events.length === 0) {
      console.log('⏭️  跳过测试：没有接收到事件');
      return;
    }
    
    // 查找心跳事件
    const heartbeatEvent = webhookServer.events.find(
      e => e.post_type === 'meta_event' && e.meta_event_type === 'heartbeat'
    );
    
    if (heartbeatEvent) {
      console.log('✅ 找到心跳事件');
      expect(heartbeatEvent).toHaveProperty('interval');
      expect(heartbeatEvent).toHaveProperty('status');
      expect(typeof heartbeatEvent.interval).toBe('number');
    } else {
      console.log('⚠️  未找到心跳事件');
    }
  });
});
