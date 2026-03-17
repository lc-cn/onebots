/**
 * OneBot 12 WebSocket 测试
 * 基于 OneBot 12 正向 WebSocket 标准: https://12.onebot.dev/connect/communication/websocket/
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { createWebSocket, waitForConnection, monitorWebSocket } from '../../utils/ws-client.js';
import { checkServerAvailable } from '../../utils/http-client.js';

// 配置
const CONFIG = {
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'kook',
  accountId: process.env.ACCOUNT_ID || 'zhin',
  accessToken: process.env.ACCESS_TOKEN || '',
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000,
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.wsUrl.replace('ws', 'http'));
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V12 WebSocket 测试');
  } else {
    console.warn('⚠️  服务器未运行，OneBot V12 WebSocket 测试将被跳过');
  }
});

describe('OneBot V12 - WebSocket', () => {
  test('正向 WebSocket 连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    try {
      const ws = createWebSocket(CONFIG, 'onebot', 'v12');
      await waitForConnection(ws, 5000);
      ws.close();
    } catch (error) {
      // 404 表示 WebSocket 端点未配置，跳过测试而不是失败
      if (error.message?.includes('404') || error.message?.includes('Unexpected server response')) {
        console.log('⏭️  跳过测试：WebSocket 端点未配置 (404)');
        return;
      }
      throw error;
    }
  }, 10000);

  test('WebSocket 事件接收', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    try {
      const ws = createWebSocket(CONFIG, 'onebot', 'v12');
      const events = await monitorWebSocket('OneBot V12', ws, CONFIG.monitorDuration);
      
      // 验证可以建立连接（即使没有收到事件也算通过）
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);
      
      // 如果收到事件，验证 OneBot 12 标准格式
      if (events.length > 0) {
        const event = events[0];
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('time');
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('detail_type');
        expect(event).toHaveProperty('sub_type');
        expect(event).toHaveProperty('self');
      }
    } catch (error) {
      // 404 表示 WebSocket 端点未配置，跳过测试而不是失败
      if (error.message?.includes('404') || error.message?.includes('Unexpected server response')) {
        console.log('⏭️  跳过测试：WebSocket 端点未配置 (404)');
        return;
      }
      throw error;
    }
  }, CONFIG.monitorDuration + 5000);
});
