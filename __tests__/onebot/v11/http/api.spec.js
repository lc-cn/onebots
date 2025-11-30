/**
 * OneBot 11 HTTP API 测试（优化版）
 * 基于 OneBot 11 标准: https://github.com/botuniverse/onebot-11
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
    console.log('✅ 服务器可用，将执行 OneBot V11 HTTP 测试');
  } else {
    console.warn('⚠️  服务器未运行，OneBot V11 HTTP 测试将被跳过');
  }
});

afterAll(() => {
  if (unsupportedApis.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('📋 OneBot V11 不支持的 API 汇总 (共 ' + unsupportedApis.length + ' 个)');
    console.log('='.repeat(70));
    unsupportedApis.forEach((api, index) => {
      console.log(`  ${(index + 1).toString().padStart(2, ' ')}. ${api}`);
    });
    console.log('='.repeat(70) + '\n');
  } else if (serverAvailable) {
    console.log('\n✅ 所有测试的 API 均已支持！\n');
  }
});

describe('OneBot V11 - HTTP API', () => {
  describe('元 API', () => {
    test('get_login_info - 获取登录号信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_login_info');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(data.status).toBe('ok');
      expect(data.data).toHaveProperty('user_id');
      expect(data.data).toHaveProperty('nickname');
    });

    test('get_version_info - 获取版本信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_version_info');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(data.status).toBe('ok');
      expect(data.data).toHaveProperty('app_name');
      expect(data.data).toHaveProperty('app_version');
    });

    test('get_status - 获取运行状态', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_status');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      expect(data.status).toBe('ok');
      expect(data.data).toHaveProperty('online');
      expect(data.data).toHaveProperty('good');
    });
  });

  describe('消息 API', () => {
    test('send_private_msg - 发送私聊消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'send_private_msg', {
        user_id: 987654321,
        message: 'OneBot 11 标准测试消息',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('user_id');
        expect(data.data).toHaveProperty('nickname');
      } else if (data.status === 'failed') {
        unsupportedApis.push('send_private_msg - 发送私聊消息');
      }
    });

    test('send_group_msg - 发送群消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'send_group_msg', {
        group_id: 123456789,
        message: 'OneBot 11 群消息测试',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('send_group_msg - 发送群消息');
      }
    });

    test('send_msg - 发送消息（通用）', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'send_msg', {
        message_type: 'private',
        user_id: 987654321,
        message: '通用消息测试',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('send_msg - 发送消息（通用）');
      }
    });

    test('delete_msg - 撤回消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'delete_msg', {
        message_id: 123456,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('delete_msg - 撤回消息');
      }
    });

    test('get_msg - 获取消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_msg', {
        message_id: 123456,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('message_id');
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_msg - 获取消息');
      }
    });

    test('get_forward_msg - 获取合并转发消息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_forward_msg', {
        message_id: 123456,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_forward_msg - 获取合并转发消息');
      }
    });

    test('send_like - 发送好友赞', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'send_like', {
        user_id: 987654321,
        times: 1,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('send_like - 发送好友赞');
      }
    });
  });

  describe('用户 API', () => {
    test('get_stranger_info - 获取陌生人信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_stranger_info', {
        user_id: 987654321,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_stranger_info - 获取陌生人信息');
      }
    });

    test('get_friend_list - 获取好友列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_friend_list');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_friend_list - 获取好友列表');
      }
    });
  });

  describe('群组 API', () => {
    test('get_group_list - 获取群列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_group_list');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(Array.isArray(data.data)).toBe(true);
        if (data.data.length > 0) {
          expect(data.data[0]).toHaveProperty('group_id');
          expect(data.data[0]).toHaveProperty('group_name');
        }
      } else if (data.status === 'failed') {
        unsupportedApis.push('get_group_list - '+data.message);
      }
    });

    test('get_group_info - 获取群信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_group_info', {
        group_id: 123456789,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_group_info - 获取群信息');
      }
    });

    test('get_group_member_info - 获取群成员信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_group_member_info', {
        group_id: 123456789,
        user_id: 987654321,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_group_member_info - 获取群成员信息');
      }
    });

    test('get_group_member_list - 获取群成员列表', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_group_member_list', {
        group_id: 123456789,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_group_member_list - 获取群成员列表');
      }
    });

    test('get_group_honor_info - 获取群荣誉信息', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_group_honor_info', {
        group_id: 123456789,
        type: 'all',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_group_honor_info - 获取群荣誉信息');
      }
    });

    test('set_group_kick - 群组踢人', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_kick', {
        group_id: 123456789,
        user_id: 987654321,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_kick - 群组踢人');
      }
    });

    test('set_group_ban - 群组单人禁言', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_ban', {
        group_id: 123456789,
        user_id: 987654321,
        duration: 60,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_ban - 群组单人禁言');
      }
    });

    test('set_group_whole_ban - 群组全员禁言', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_whole_ban', {
        group_id: 123456789,
        enable: false,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_whole_ban - 群组全员禁言');
      }
    });

    test('set_group_admin - 群组设置管理员', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_admin', {
        group_id: 123456789,
        user_id: 987654321,
        enable: true,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_admin - 群组设置管理员');
      }
    });

    test('set_group_card - 设置群名片', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_card', {
        group_id: 123456789,
        user_id: 987654321,
        card: '测试名片',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_card - 设置群名片');
      }
    });

    test('set_group_name - 设置群名', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_name', {
        group_id: 123456789,
        group_name: '测试群名',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_name - 设置群名');
      }
    });

    test('set_group_leave - 退出群组', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_leave', {
        group_id: 999999999,
        is_dismiss: false,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_leave - 退出群组');
      }
    });

    test('set_group_special_title - 设置群组专属头衔', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_special_title', {
        group_id: 123456789,
        user_id: 987654321,
        special_title: '测试头衔',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_special_title - 设置群组专属头衔');
      }
    });
  });

  describe('请求处理 API', () => {
    test('set_friend_add_request - 处理加好友请求', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_friend_add_request', {
        flag: 'test_flag',
        approve: true,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_friend_add_request - 处理加好友请求');
      }
    });

    test('set_group_add_request - 处理加群请求/邀请', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_group_add_request', {
        flag: 'test_flag',
        sub_type: 'add',
        approve: true,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_group_add_request - 处理加群请求/邀请');
      }
    });
  });

  describe('文件/媒体 API', () => {
    test('get_image - 获取图片', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_image', {
        file: 'test.jpg',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_image - 获取图片');
      }
    });

    test('get_record - 获取语音', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_record', {
        file: 'test.silk',
        out_format: 'mp3',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_record - 获取语音');
      }
    });

    test('can_send_image - 检查是否可以发送图片', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'can_send_image');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('yes');
        expect(typeof data.data.yes).toBe('boolean');
      } else if (data.status === 'failed') {
        unsupportedApis.push('can_send_image - 检查是否可以发送图片');
      }
    });

    test('can_send_record - 检查是否可以发送语音', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'can_send_record');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'ok') {
        expect(data.data).toHaveProperty('yes');
        expect(typeof data.data.yes).toBe('boolean');
      } else if (data.status === 'failed') {
        unsupportedApis.push('can_send_record - 检查是否可以发送语音');
      }
    });
  });

  describe('系统 API', () => {
    test('get_cookies - 获取 Cookies', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_cookies', {
        domain: 'qun.qq.com',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_cookies - 获取 Cookies');
      }
    });

    test('get_csrf_token - 获取 CSRF Token', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_csrf_token');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_csrf_token - 获取 CSRF Token');
      }
    });

    test('get_credentials - 获取 QQ 相关接口凭证', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'get_credentials', {
        domain: 'qun.qq.com',
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('get_credentials - 获取 QQ 相关接口凭证');
      }
    });

    test('set_restart - 重启 OneBot 实现', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'set_restart', {
        delay: 0,
      });
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('set_restart - 重启 OneBot 实现');
      }
    });

    test('clean_cache - 清理缓存', async () => {
      if (!serverAvailable) {
        console.log('⏭️  跳过测试：服务器不可用');
        return;
      }
      
      const { status, data } = await httpRequest(CONFIG, 'onebot', 'v11', 'clean_cache');
      
      expect(status).toBe(200);
      expect(data).toBeDefined();
      if (data.status === 'failed') {
        unsupportedApis.push('clean_cache - 清理缓存');
      }
    });
  });
});
