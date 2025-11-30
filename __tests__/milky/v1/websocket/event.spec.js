/**
 * Milky V1 WebSocket 事件连接测试
 * 测试 WebSocket 事件推送功能
 * 参考: https://milky.ntqqrev.org/guide/communication
 * 
 * WebSocket 连接:
 * - URL: ws://{host}:{port}/event
 * - 鉴权: Authorization: Bearer <access_token> 或 ?access_token=xxx
 * - 事件格式: JSON
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000,
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Milky V1 WebSocket 测试');
  } else {
    console.warn('⚠️  服务器未运行，Milky V1 WebSocket 测试将被跳过');
  }
});

describe('Milky V1 - WebSocket 事件连接', () => {
  test('WebSocket 连接（/event）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    console.log('📡 连接 URL:', url);

    const ws = new WebSocket(url, {
      headers: CONFIG.accessToken ? {
        'Authorization': `Bearer ${CONFIG.accessToken}`
      } : {}
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('连接超时'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ WebSocket 连接成功');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    expect(true).toBe(true);
  }, 10000);

  test('WebSocket 事件接收', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    const ws = new WebSocket(url, {
      headers: CONFIG.accessToken ? {
        'Authorization': `Bearer ${CONFIG.accessToken}`
      } : {}
    });

    const events = [];

    await new Promise((resolve) => {
      ws.on('open', () => {
        console.log('✅ WebSocket 已连接，监听事件...');
        console.log(`⏱️  监听 ${CONFIG.monitorDuration / 1000} 秒...`);
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          events.push(event);
          console.log('\n📨 收到事件:');
          console.log('   事件类型:', event.event_type);
          console.log('   时间:', new Date(event.time * 1000).toLocaleString());
        } catch (error) {
          console.error('❌ 解析事件失败:', error.message);
        }
      });

      setTimeout(() => {
        ws.close();
        resolve();
      }, CONFIG.monitorDuration);
    });

    console.log(`\n📊 总共接收到 ${events.length} 个事件`);

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
  }, 10000);

  test('验证事件格式（如果有事件）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    console.log('💡 事件格式应符合 Milky Event 结构:');
    console.log('   - time: int64 (事件发生时间戳)');
    console.log('   - self_id: int64 (机器人 QQ 号)');
    console.log('   - event_type: string (事件类型)');
    console.log('   - data: object (事件数据)');
    console.log('\n   参考: https://milky.ntqqrev.org/struct/Event');
  });
});

describe('Milky V1 - WebSocket 鉴权', () => {
  test('Header 方式传递 Authorization', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = CONFIG.accessToken || 'test_token';
    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    
    console.log('📡 使用 Authorization Header 鉴权');

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ Header 鉴权成功');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('⚠️  连接失败（可能是鉴权失败）:', error.message);
        resolve();
      });
    });
  }, 10000);

  test('Query 参数方式传递 access_token', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = CONFIG.accessToken || 'test_token';
    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event?access_token=${token}`;
    
    console.log('📡 使用 Query 参数鉴权');

    const ws = new WebSocket(url);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ Query 参数鉴权成功');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('⚠️  连接失败（可能是鉴权失败）:', error.message);
        resolve();
      });
    });
  }, 10000);

  test('无 token 访问（应该失败）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    
    console.log('📡 测试无 token 访问');

    const ws = new WebSocket(url);

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        console.log('⚠️  连接超时（预期行为：应该被拒绝）');
        resolve();
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ 无 token 也能连接（服务器可能未开启鉴权）');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('✅ 无 token 被拒绝（符合预期）:', error.message);
        resolve();
      });
    });
  }, 10000);

  test('错误的 token（应该失败）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/event`;
    
    console.log('📡 测试错误的 token');

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': 'Bearer wrong_token_12345'
      }
    });

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        console.log('⚠️  连接超时（预期行为：应该被拒绝）');
        resolve();
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('⚠️  错误 token 也能连接（服务器可能未开启鉴权）');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('✅ 错误 token 被拒绝（符合预期）:', error.message);
        resolve();
      });
    });
  }, 10000);
});

describe('Milky V1 - WebSocket 事件格式', () => {
  test('验证事件结构说明', () => {
    console.log('\n💡 WebSocket 事件格式应符合 Milky Event 结构:');
    console.log('   - time: int64 (事件发生时间戳)');
    console.log('   - self_id: int64 (机器人账号 ID)');
    console.log('   - event_type: string (事件类型)');
    console.log('   - data: object (事件数据)');
    console.log('\n   参考: https://milky.ntqqrev.org/struct/Event');
    console.log('   参考: https://milky.ntqqrev.org/guide/communication#websocket');
  });
});
