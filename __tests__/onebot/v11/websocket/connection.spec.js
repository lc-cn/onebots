/**
 * OneBot 11 WebSocket 测试
 * 基于 OneBot 11 正向 WebSocket 标准: https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { createWebSocket, waitForConnection, monitorWebSocket } from '../../utils/ws-client.js';
import { checkServerAvailable } from '../../utils/http-client.js';

// 配置
const CONFIG = {
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000,
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.wsUrl.replace('ws', 'http'));
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 WebSocket 测试');
  } else {
    console.warn('⚠️  服务器未运行，OneBot V11 WebSocket 测试将被跳过');
  }
});

describe('OneBot V11 - WebSocket', () => {
  test('正向 WebSocket 连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const ws = createWebSocket(CONFIG, 'onebot', 'v11');
    
    await expect(waitForConnection(ws, 5000)).resolves.toBeUndefined();
    ws.close();
  }, 10000);

  test('WebSocket 事件接收', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const ws = createWebSocket(CONFIG, 'onebot', 'v11');
    const events = await monitorWebSocket('OneBot V11', ws, CONFIG.monitorDuration);
    
    // 验证可以建立连接（即使没有收到事件也算通过）
    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
    
    // 如果收到事件，验证格式
    if (events.length > 0) {
      const event = events[0];
      expect(event).toHaveProperty('time');
      expect(event).toHaveProperty('post_type');
    }
  }, CONFIG.monitorDuration + 5000);
});
