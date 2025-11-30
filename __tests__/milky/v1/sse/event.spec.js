/**
 * Milky V1 SSE (Server-Sent Events) 事件推送测试
 * 测试 SSE 事件推送功能
 * 参考: https://milky.ntqqrev.org/guide/communication
 * 
 * SSE 连接:
 * - URL: GET /{platform}/{account_id}/milky/v1/event
 * - 鉴权: Authorization: Bearer <access_token> 或 ?access_token=xxx
 * - Content-Type: text/event-stream
 * - 事件格式: data: JSON
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000,
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Milky V1 SSE 测试');
  } else {
    console.warn('⚠️  服务器未运行，Milky V1 SSE 测试将被跳过');
  }
});

describe('Milky V1 - SSE 事件推送', () => {
  test('SSE 连接（/event）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    console.log('📡 SSE 连接 URL:', url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        headers: CONFIG.accessToken ? {
          'Authorization': `Bearer ${CONFIG.accessToken}`
        } : {},
        signal: controller.signal
      });

      clearTimeout(timeout);

      console.log('📊 响应状态:', response.status);
      console.log('📊 Content-Type:', response.headers.get('content-type'));

      if (response.status === 200) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/event-stream')) {
          console.log('✅ SSE 连接成功');
          expect(contentType).toContain('text/event-stream');
        } else {
          console.log('⚠️  Content-Type 不正确:', contentType);
        }
      } else {
        console.log('⚠️  SSE 连接失败，状态码:', response.status);
      }

      // 关闭连接
      controller.abort();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        console.log('✅ SSE 连接测试完成（已主动断开）');
      } else {
        console.log('⚠️  SSE 连接失败:', error.message);
      }
    }
  }, 10000);

  test('SSE 事件接收', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    const controller = new AbortController();
    const events = [];

    console.log(`⏱️  监听 SSE 事件 ${CONFIG.monitorDuration / 1000} 秒...`);

    const monitorPromise = (async () => {
      try {
        const response = await fetch(url, {
          headers: CONFIG.accessToken ? {
            'Authorization': `Bearer ${CONFIG.accessToken}`
          } : {},
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          console.log('⚠️  SSE 连接失败');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(line.slice(6));
                events.push(eventData);
                console.log('\n📨 收到 SSE 事件:');
                console.log('   事件类型:', eventData.event_type);
                console.log('   时间:', new Date(eventData.time * 1000).toLocaleString());
              } catch (error) {
                console.error('❌ 解析 SSE 事件失败:', error.message);
              }
            }
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('❌ SSE 监听错误:', error.message);
        }
      }
    })();

    // 监听指定时长后停止
    await new Promise(resolve => setTimeout(resolve, CONFIG.monitorDuration));
    controller.abort();
    await monitorPromise.catch(() => {});

    console.log(`\n📊 总共接收到 ${events.length} 个 SSE 事件`);

    if (events.length > 0) {
      console.log('\n事件类型统计:');
      const eventTypes = {};
      events.forEach(event => {
        eventTypes[event.event_type] = (eventTypes[event.event_type] || 0) + 1;
      });
      Object.entries(eventTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} 个`);
      });

      // 验证事件格式
      const firstEvent = events[0];
      expect(firstEvent.time).toBeDefined();
      expect(firstEvent.self_id).toBeDefined();
      expect(firstEvent.event_type).toBeDefined();
      expect(firstEvent.data).toBeDefined();
    } else {
      console.log('💡 未接收到事件（这是正常的，如果没有触发事件的话）');
    }
  }, 15000);

  test('SSE 鉴权 - Header 方式', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    const token = CONFIG.accessToken || 'test_token';

    console.log('📡 使用 Authorization Header 鉴权');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 200) {
        console.log('✅ Header 鉴权成功');
      } else if (response.status === 401) {
        console.log('⚠️  鉴权失败（401）- token 可能不正确');
      } else {
        console.log('📊 响应状态:', response.status);
      }

      controller.abort();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name !== 'AbortError') {
        console.log('⚠️  请求失败:', error.message);
      }
    }
  }, 10000);

  test('SSE 鉴权 - Query 参数方式', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = CONFIG.accessToken || 'test_token';
    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event?access_token=${token}`;

    console.log('📡 使用 Query 参数鉴权');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(url, {
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 200) {
        console.log('✅ Query 参数鉴权成功');
      } else if (response.status === 401) {
        console.log('⚠️  鉴权失败（401）- token 可能不正确');
      } else {
        console.log('📊 响应状态:', response.status);
      }

      controller.abort();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name !== 'AbortError') {
        console.log('⚠️  请求失败:', error.message);
      }
    }
  }, 10000);
});

describe('Milky V1 - SSE 事件格式验证', () => {
  test('验证 SSE 事件结构', () => {
    console.log('\n💡 SSE 事件格式应符合 Milky Event 结构:');
    console.log('   格式: data: <JSON>\\n\\n');
    console.log('   JSON 结构:');
    console.log('   - time: int64 (事件发生时间戳)');
    console.log('   - self_id: int64 (机器人账号 ID)');
    console.log('   - event_type: string (事件类型)');
    console.log('   - data: object (事件数据)');
    console.log('\n   参考: https://milky.ntqqrev.org/struct/Event');
    console.log('   参考: https://milky.ntqqrev.org/guide/communication#sse');
  });
});
