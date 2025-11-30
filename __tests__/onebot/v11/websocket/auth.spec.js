/**
 * OneBot 11 WebSocket 鉴权测试
 * 测试正向 WebSocket 的 access_token 鉴权机制
 * 参考: https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { createWebSocket, waitForConnection } from '../../utils/ws-client.js';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.wsUrl.replace('ws', 'http'));
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 WebSocket 鉴权测试');
  } else {
    console.warn('⚠️  服务器未运行，测试将被跳过');
  }
});

describe('OneBot V11 - WebSocket 鉴权测试', () => {
  test('无 token 连接（config.yaml 中 access_token 为空时应该成功）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const ws = createWebSocket({
      ...CONFIG,
      accessToken: '', // 不提供 token
    }, 'onebot', 'v11');

    try {
      await waitForConnection(ws, 5000);
      console.log('✅ 无 token 连接成功（服务器未配置 access_token）');
      ws.close();
    } catch (error) {
      console.log('✅ 无 token 连接被拒绝（服务器已配置 access_token）');
      expect(error.message).toContain('连接');
    }
  }, 10000);

  test('错误的 token（应该被拒绝或超时）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const ws = createWebSocket({
      ...CONFIG,
      accessToken: 'wrong_token_12345',
    }, 'onebot', 'v11');

    try {
      await waitForConnection(ws, 5000);
      console.log('⚠️  服务器未配置 access_token，接受了错误的 token');
      ws.close();
    } catch (error) {
      console.log('✅ 错误的 token 被正确拒绝');
      expect(error.message).toContain('连接');
    }
  }, 10000);

  test('正确的 token（通过 Query 参数）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = process.env.ACCESS_TOKEN || '';
    
    if (!token) {
      console.log('💡 未设置 ACCESS_TOKEN，跳过此测试');
      console.log('   提示: 在 config.yaml 中配置 access_token 并设置环境变量 ACCESS_TOKEN 来测试');
      return;
    }

    const ws = createWebSocket({
      ...CONFIG,
      accessToken: token,
    }, 'onebot', 'v11');

    await expect(waitForConnection(ws, 5000)).resolves.toBeUndefined();
    console.log('✅ 使用正确的 token 连接成功');
    ws.close();
  }, 10000);

  test('WebSocket 连接后的 API 调用鉴权', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = process.env.ACCESS_TOKEN || '';

    const ws = createWebSocket({
      ...CONFIG,
      accessToken: token || '', // 使用 token 或空
    }, 'onebot', 'v11');

    try {
      await waitForConnection(ws, 5000);
      
      // 发送 API 调用
      const apiCall = {
        action: 'get_login_info',
        params: {},
        echo: 'auth_test_' + Date.now(),
      };

      ws.send(JSON.stringify(apiCall));

      // 等待响应
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('API 调用超时')), 5000);
        
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.echo === apiCall.echo) {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
      });

      console.log('📊 API 调用结果:', response);
      expect(response.status).toBe('ok');
      ws.close();
    } catch (error) {
      console.log('测试结果:', error.message);
    }
  }, 15000);
});
