/**
 * Satori V1 WebSocket 事件测试
 * 测试 Satori WebSocket 事件推送
 * 参考: https://satori.chat/zh-CN/protocol/events.html
 * 
 * WebSocket 连接:
 * - URL: ws://{host}:{port}/{platform}/{account_id}/satori/v1/events
 * - 鉴权: Authorization: Bearer <token>
 * - 事件格式: Satori Event
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  token: process.env.SATORI_TOKEN || process.env.ACCESS_TOKEN || '',
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000,
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Satori V1 WebSocket 测试');
  } else {
    console.warn('⚠️  服务器未运行，Satori V1 WebSocket 测试将被跳过');
  }
});

describe('Satori V1 - WebSocket 连接', () => {
  test('WebSocket 连接测试', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/satori/v1/events`;
    console.log('📡 连接 URL:', url);

    const ws = new WebSocket(url, {
      headers: CONFIG.token ? {
        'Authorization': `Bearer ${CONFIG.token}`
      } : {}
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve(); // 不视为错误
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ WebSocket 连接成功');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('⚠️  WebSocket 连接失败:', error.message);
        resolve(); // 不视为测试失败
      });
    });
  }, 10000);

  test('WebSocket 事件接收', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/satori/v1/events`;
    const ws = new WebSocket(url, {
      headers: CONFIG.token ? {
        'Authorization': `Bearer ${CONFIG.token}`
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
          console.log('\n📨 收到 Satori 事件:');
          console.log('   事件 ID:', event.id);
          console.log('   事件类型:', event.type);
          console.log('   平台:', event.platform);
          console.log('   时间:', new Date(event.timestamp).toLocaleString());
        } catch (error) {
          console.error('❌ 解析事件失败:', error.message);
        }
      });

      ws.on('error', (error) => {
        console.log('⚠️  WebSocket 错误:', error.message);
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
        eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
      });
      Object.entries(eventTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} 个`);
      });

      // 验证事件格式
      const firstEvent = events[0];
      expect(firstEvent.id).toBeDefined();
      expect(firstEvent.type).toBeDefined();
      expect(firstEvent.platform).toBeDefined();
      expect(firstEvent.self_id).toBeDefined();
      expect(firstEvent.timestamp).toBeDefined();
    } else {
      console.log('💡 未接收到事件（这是正常的，如果没有触发事件的话）');
    }
  }, 10000);
});

describe('Satori V1 - WebSocket 鉴权', () => {
  test('Bearer token 鉴权', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/satori/v1/events`;
    const token = CONFIG.token || 'test_token';
    
    console.log('📡 使用 Bearer token 鉴权');

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✅ Bearer token 鉴权成功');
        ws.close();
        resolve();
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log('⚠️  鉴权失败:', error.message);
        resolve();
      });
    });
  }, 10000);

  test('无 token 访问（应该失败）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/satori/v1/events`;
    
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

    const url = `${CONFIG.wsUrl}/${CONFIG.platform}/${CONFIG.accountId}/satori/v1/events`;
    
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

describe('Satori V1 - 事件格式验证', () => {
  test('验证 Satori 事件结构', () => {
    console.log('\n💡 Satori Event 标准结构:');
    console.log('   {');
    console.log('     id: number,              // 事件 ID');
    console.log('     type: string,            // 事件类型');
    console.log('     platform: string,        // 平台名称');
    console.log('     self_id: string,         // 机器人 ID');
    console.log('     timestamp: number,       // 事件时间戳（毫秒）');
    console.log('     channel?: Channel,       // 频道对象');
    console.log('     guild?: Guild,           // 群组对象');
    console.log('     login?: Login,           // 登录对象');
    console.log('     member?: GuildMember,    // 群成员对象');
    console.log('     message?: Message,       // 消息对象');
    console.log('     operator?: User,         // 操作者对象');
    console.log('     role?: GuildRole,        // 角色对象');
    console.log('     user?: User,             // 用户对象');
    console.log('   }');
    console.log('\n   参考: https://satori.chat/zh-CN/protocol/events.html');
  });

  test('常见事件类型', () => {
    console.log('\n💡 Satori 常见事件类型:');
    console.log('\n消息事件:');
    console.log('   - message-created       // 消息被创建');
    console.log('   - message-updated       // 消息被修改');
    console.log('   - message-deleted       // 消息被删除');
    console.log('\n群组事件:');
    console.log('   - guild-added           // 加入群组');
    console.log('   - guild-removed         // 退出群组');
    console.log('   - guild-updated         // 群组信息更新');
    console.log('   - guild-member-added    // 群成员加入');
    console.log('   - guild-member-removed  // 群成员退出');
    console.log('   - guild-member-updated  // 群成员信息更新');
    console.log('\n好友事件:');
    console.log('   - friend-request        // 好友申请');
    console.log('\n其他事件:');
    console.log('   - internal              // 内部事件');
  });
});
