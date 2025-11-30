/**
 * OneBot 12 HTTP API 测试
 * 基于 OneBot 12 标准: https://12.onebot.dev/
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { httpRequest, checkServerAvailable } from '../../utils/http-client.js';

// 配置
const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  timeout: 10000,
};

let serverAvailable = false;
const unsupportedApis = [];

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V12 HTTP 测试');
  } else {
    console.warn('⚠️  服务器未运行，OneBot V12 HTTP 测试将被跳过');
  }
});

afterAll(() => {
  if (unsupportedApis.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('📋 OneBot V12 不支持的动作汇总 (共 ' + unsupportedApis.length + ' 个)');
    console.log('='.repeat(70));
    unsupportedApis.forEach((api, index) => {
      console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${api}`);
    });
    console.log('='.repeat(70) + '\n');
  } else if (serverAvailable) {
    console.log('\n✅ 所有测试的动作均已支持！\n');
  }
});

describe('OneBot V12 - HTTP API', () => {
  describe('元动作 (Meta Actions)', () => {
    test('get_version - 获取版本信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_version');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      // OneBot 12 标准响应格式
      expect(data.status).toBe('ok');
      expect(data.retcode).toBe(0);
      expect(data.data).toBeDefined();
      expect(data.data).toHaveProperty('impl');
      expect(data.data).toHaveProperty('version');
      expect(data.data).toHaveProperty('onebot_version');
      expect(data.data.onebot_version).toBe('12');
    });

    test('get_supported_actions - 获取支持的动作列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_supported_actions');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(data.status).toBe('ok');
      expect(data.retcode).toBe(0);
      expect(Array.isArray(data.data)).toBe(true);
      // 验证至少包含标准动作
      const actions = data.data.map(a => typeof a === 'string' ? a : a.action);
      expect(actions).toContain('get_version');
      expect(actions).toContain('get_supported_actions');
    });

    test('get_status - 获取运行状态', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_status');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(data.status).toBe('ok');
      expect(data.retcode).toBe(0);
      expect(data.data).toBeDefined();
      // OneBot 12 标准：Status 包含 good 和 bots 数组
      expect(data.data).toHaveProperty('good');
      expect(data.data).toHaveProperty('bots');
      expect(Array.isArray(data.data.bots)).toBe(true);
      // bots 数组中的每个元素包含 online 字段
      if (data.data.bots.length > 0) {
        expect(data.data.bots[0]).toHaveProperty('online');
        expect(data.data.bots[0]).toHaveProperty('self');
      }
    });
  });

  describe('用户动作 (User Actions)', () => {
    test('get_self_info - 获取机器人自身信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_self_info');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(data.status).toBe('ok');
      expect(data.retcode).toBe(0);
      expect(data.data).toBeDefined();
      expect(data.data).toHaveProperty('user_id');
      expect(data.data).toHaveProperty('user_name');
    });

    test('get_user_info - 获取用户信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_user_info', {
        user_id: 'test_user_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('user_id');
        expect(data.data).toHaveProperty('user_name');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_user_info - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_friend_list - 获取好友列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_friend_list');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
        if (data.data.length > 0) {
          expect(data.data[0]).toHaveProperty('user_id');
          expect(data.data[0]).toHaveProperty('user_name');
        }
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_friend_list - '+(data.message || data.msg || '不支持'));
      }
    });
  });

  describe('消息动作 (Message Actions)', () => {
    test('send_message - 发送消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'send_message', {
        detail_type: 'private',
        user_id: 'test_user_123',
        message: [
          { type: 'text', data: { text: 'OneBot 12 标准测试消息' } }
        ],
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      // 允许返回成功或失败（取决于平台是否支持）
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('message_id');
        expect(data.data).toHaveProperty('time');
      } else if (data.status === 'failed') {
        unsupportedApis.push('send_message - '+(data.message || data.msg || '不支持'));
      }
    });

    test('delete_message - 删除消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'delete_message', {
        message_id: 'test_message_id',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('delete_message - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_message - 获取消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_message', {
        message_id: 'test_message_id',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('message_id');
        expect(data.data).toHaveProperty('message');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_message - '+(data.message || data.msg || '不支持'));
      }
    });
  });

  describe('群组动作 (Group Actions)', () => {
    test('get_group_info - 获取群信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_group_info', {
        group_id: 'test_group_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('group_id');
        expect(data.data).toHaveProperty('group_name');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_group_info - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_group_list - 获取群列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_group_list');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
        if (data.data.length > 0) {
          expect(data.data[0]).toHaveProperty('group_id');
          expect(data.data[0]).toHaveProperty('group_name');
        }
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_group_list - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_group_member_info - 获取群成员信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_group_member_info', {
        group_id: 'test_group_123',
        user_id: 'test_user_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('user_id');
        expect(data.data).toHaveProperty('user_name');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_group_member_info - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_group_member_list - 获取群成员列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_group_member_list', {
        group_id: 'test_group_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_group_member_list - '+(data.message || data.msg || '不支持'));
      }
    });

    test('set_group_name - 设置群名称', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'set_group_name', {
        group_id: 'test_group_123',
        group_name: 'OneBot 12 测试群',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_name - '+(data.message || data.msg || '不支持'));
      }
    });

    test('leave_group - 退出群组', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'leave_group', {
        group_id: 'nonexistent_group_999', // 使用不存在的群避免真的退出
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('leave_group - '+(data.message || data.msg || '不支持'));
      }
    });
  });

  describe('频道动作 (Guild/Channel Actions)', () => {
    test('get_guild_info - 获取群组信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_guild_info', {
        guild_id: 'test_guild_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('guild_id');
        expect(data.data).toHaveProperty('guild_name');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_guild_info - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_guild_list - 获取群组列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_guild_list');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_guild_list - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_guild_member_info - 获取群组成员信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_guild_member_info', {
        guild_id: 'test_guild_123',
        user_id: 'test_user_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('user_id');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_guild_member_info - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_channel_info - 获取频道信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_channel_info', {
        guild_id: 'test_guild_123',
        channel_id: 'test_channel_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('channel_id');
        expect(data.data).toHaveProperty('channel_name');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_channel_info - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_channel_list - 获取频道列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_channel_list', {
        guild_id: 'test_guild_123',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_channel_list - '+(data.message || data.msg || '不支持'));
      }
    });
  });

  describe('文件动作 (File Actions)', () => {
    test('upload_file - 上传文件', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'upload_file', {
        type: 'url',
        name: 'test.txt',
        url: 'https://example.com/test.txt',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('file_id');
      } else if (data.status === 'failed') {
        unsupportedApis.push('upload_file - '+(data.message || data.msg || '不支持'));
      }
    });

    test('get_file - 获取文件', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'get_file', {
        file_id: 'test_file_id',
        type: 'url',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('name');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_file - '+(data.message || data.msg || '不支持'));
      }
    });

    test('delete_file - 删除文件', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v12', 'delete_file', {
        file_id: 'test_file_id',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('delete_file - '+(data.message || data.msg || '不支持'));
      }
    });
  });
});
