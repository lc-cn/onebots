/**
 * Milky V1 HTTP API 测试
 * 基于 Milky 1.0 标准: https://milky.ntqqrev.org/
 * 
 * API 分类:
 * - 系统 API: https://milky.ntqqrev.org/api/system
 * - 消息 API: https://milky.ntqqrev.org/api/message
 * - 好友 API: https://milky.ntqqrev.org/api/friend
 * - 群聊 API: https://milky.ntqqrev.org/api/group
 * - 文件 API: https://milky.ntqqrev.org/api/file
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { callMilkyAPI, checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  timeout: 5000,
};

let serverAvailable = false;
const unsupportedApis = [];

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Milky V1 HTTP API 测试');
  } else {
    console.warn('⚠️  服务器未运行，Milky V1 HTTP API 测试将被跳过');
  }
});

afterAll(() => {
  if (unsupportedApis.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  以下 API 不支持或返回错误:');
    console.log('='.repeat(70));
    unsupportedApis.forEach((api, index) => {
      console.log(`${index + 1}. ${api}`);
    });
    console.log('='.repeat(70) + '\n');
  }
});

describe('Milky V1 - 系统 API', () => {
  test('get_login_info - 获取登录信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_login_info', {});

    if (status === 200 && data.status === 'ok') {
      console.log('✅ get_login_info 成功');
      console.log('   UIN:', data.data.uin);
      console.log('   昵称:', data.data.nickname);
      expect(data.status).toBe('ok');
      expect(data.retcode).toBe(0);
      expect(data.data.uin).toBeDefined();
    } else {
      console.log('⚠️  get_login_info 不支持或失败');
      unsupportedApis.push('get_login_info - ' + (data?.message || '不支持'));
    }
  });

  test('get_impl_info - 获取协议端信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_impl_info', {});

    if (status === 200 && data.status === 'ok') {
      console.log('✅ get_impl_info 成功');
      console.log('   实现名称:', data.data.impl_name);
      console.log('   实现版本:', data.data.impl_version);
      console.log('   Milky 版本:', data.data.milky_version);
      expect(data.status).toBe('ok');
      expect(data.data.impl_name).toBeDefined();
      expect(data.data.milky_version).toBeDefined();
    } else {
      console.log('⚠️  get_impl_info 不支持或失败');
      unsupportedApis.push('get_impl_info - ' + (data?.message || '不支持'));
    }
  });

  test('get_user_profile - 获取用户个人信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_user_profile', {
      user_id: 123456789,
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_user_profile 成功');
        expect(data.data.nickname).toBeDefined();
      } else {
        console.log('⚠️  get_user_profile 失败:', data.message);
        unsupportedApis.push('get_user_profile - ' + data.message);
      }
    }
  });

  test('get_friend_list - 获取好友列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_friend_list', {
      no_cache: false,
    });

    if (status === 200 && data.status === 'ok') {
      console.log('✅ get_friend_list 成功');
      console.log('   好友数量:', data.data.friends?.length || 0);
      expect(data.status).toBe('ok');
      expect(Array.isArray(data.data.friends)).toBe(true);
    } else {
      console.log('⚠️  get_friend_list 不支持或失败');
      unsupportedApis.push('get_friend_list - ' + (data?.message || '不支持'));
    }
  });

  test('get_friend_info - 获取好友信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_friend_info', {
      user_id: 123456789,
      no_cache: false,
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_friend_info 成功');
        expect(data.data.friend).toBeDefined();
      } else {
        console.log('⚠️  get_friend_info 失败:', data.message);
        unsupportedApis.push('get_friend_info - ' + data.message);
      }
    }
  });

  test('get_group_list - 获取群列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_list', {
      no_cache: false,
    });

    if (status === 200 && data.status === 'ok') {
      console.log('✅ get_group_list 成功');
      console.log('   群数量:', data.data.groups?.length || 0);
      expect(data.status).toBe('ok');
      expect(Array.isArray(data.data.groups)).toBe(true);
    } else {
      console.log('⚠️  get_group_list 不支持或失败');
      unsupportedApis.push('get_group_list - ' + (data?.message || '不支持'));
    }
  });

  test('get_group_info - 获取群信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_info', {
      group_id: 123456789,
      no_cache: false,
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_info 成功');
        expect(data.data.group).toBeDefined();
      } else {
        console.log('⚠️  get_group_info 失败:', data.message);
        unsupportedApis.push('get_group_info - ' + data.message);
      }
    }
  });

  test('get_group_member_list - 获取群成员列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_member_list', {
      group_id: 123456789,
      no_cache: false,
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_member_list 成功');
        console.log('   成员数量:', data.data.members?.length || 0);
        expect(Array.isArray(data.data.members)).toBe(true);
      } else {
        console.log('⚠️  get_group_member_list 失败:', data.message);
        unsupportedApis.push('get_group_member_list - ' + data.message);
      }
    }
  });

  test('get_group_member_info - 获取群成员信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_member_info', {
      group_id: 123456789,
      user_id: 987654321,
      no_cache: false,
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_member_info 成功');
        expect(data.data.member).toBeDefined();
      } else {
        console.log('⚠️  get_group_member_info 失败:', data.message);
        unsupportedApis.push('get_group_member_info - ' + data.message);
      }
    }
  });

  test('get_cookies - 获取 Cookies', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_cookies', {
      domain: 'qq.com',
    });

    if (status === 200 && data.status === 'ok') {
      console.log('✅ get_cookies 成功');
      expect(data.data.cookies).toBeDefined();
    } else {
      console.log('⚠️  get_cookies 不支持或失败');
      unsupportedApis.push('get_cookies - ' + (data?.message || '不支持'));
    }
  });

  test('get_csrf_token - 获取 CSRF Token', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_csrf_token', {});

    if (status === 200 && data.status === 'ok') {
      console.log('✅ get_csrf_token 成功');
      expect(data.data.csrf_token).toBeDefined();
    } else {
      console.log('⚠️  get_csrf_token 不支持或失败');
      unsupportedApis.push('get_csrf_token - ' + (data?.message || '不支持'));
    }
  });
});

describe('Milky V1 - 消息 API', () => {
  test('send_private_message - 发送私聊消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_private_message', {
      user_id: 123456789,
      message: [
        {
          type: 'text',
          data: { text: 'Test message' }
        }
      ]
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_private_message 成功');
        expect(data.data.message_seq).toBeDefined();
      } else {
        console.log('⚠️  send_private_message 失败:', data.message);
        unsupportedApis.push('send_private_message - ' + data.message);
      }
    }
  });

  test('send_group_message - 发送群聊消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_group_message', {
      group_id: 123456789,
      message: [
        {
          type: 'text',
          data: { text: 'Test message' }
        }
      ]
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_group_message 成功');
        expect(data.data.message_seq).toBeDefined();
      } else {
        console.log('⚠️  send_group_message 失败:', data.message);
        unsupportedApis.push('send_group_message - ' + data.message);
      }
    }
  });

  test('get_message - 获取消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_message', {
      message_scene: 'friend',
      peer_id: 123456789,
      message_seq: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_message 成功');
      } else {
        console.log('⚠️  get_message 失败:', data.message);
        unsupportedApis.push('get_message - ' + data.message);
      }
    }
  });

  test('get_history_messages - 获取历史消息列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_history_messages', {
      message_scene: 'friend',
      peer_id: 123456789,
      limit: 20
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_history_messages 成功');
        console.log('   消息数量:', data.data.messages?.length || 0);
        expect(Array.isArray(data.data.messages)).toBe(true);
      } else {
        console.log('⚠️  get_history_messages 失败:', data.message);
        unsupportedApis.push('get_history_messages - ' + data.message);
      }
    }
  });

  test('recall_private_message - 撤回私聊消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'recall_private_message', {
      user_id: 123456789,
      message_seq: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ recall_private_message 成功');
      } else {
        console.log('⚠️  recall_private_message 失败:', data.message);
        unsupportedApis.push('recall_private_message - ' + data.message);
      }
    }
  });

  test('recall_group_message - 撤回群聊消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'recall_group_message', {
      group_id: 123456789,
      message_seq: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ recall_group_message 成功');
      } else {
        console.log('⚠️  recall_group_message 失败:', data.message);
        unsupportedApis.push('recall_group_message - ' + data.message);
      }
    }
  });

  test('mark_message_as_read - 标记消息为已读', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'mark_message_as_read', {
      message_scene: 'friend',
      peer_id: 123456789,
      message_seq: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ mark_message_as_read 成功');
      } else {
        console.log('⚠️  mark_message_as_read 失败:', data.message);
        unsupportedApis.push('mark_message_as_read - ' + data.message);
      }
    }
  });

  test('get_resource_temp_url - 获取资源临时 URL', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_resource_temp_url', {
      resource_id: 'test_resource_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_resource_temp_url 成功');
        expect(data.data.url).toBeDefined();
      } else {
        console.log('⚠️  get_resource_temp_url 失败:', data.message);
        unsupportedApis.push('get_resource_temp_url - ' + data.message);
      }
    }
  });

  test('get_forwarded_messages - 获取转发消息内容', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_forwarded_messages', {
      resource_id: 'test_forward_resource_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_forwarded_messages 成功');
        expect(Array.isArray(data.data.messages)).toBe(true);
      } else {
        console.log('⚠️  get_forwarded_messages 失败:', data.message);
        unsupportedApis.push('get_forwarded_messages - ' + data.message);
      }
    }
  });
});

describe('Milky V1 - 好友 API', () => {
  test('send_friend_nudge - 发送好友戳一戳', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_friend_nudge', {
      user_id: 123456789,
      is_self: false
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_friend_nudge 成功');
      } else {
        console.log('⚠️  send_friend_nudge 失败:', data.message);
        unsupportedApis.push('send_friend_nudge - ' + data.message);
      }
    }
  });

  test('send_profile_like - 发送名片点赞', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_profile_like', {
      user_id: 123456789,
      count: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_profile_like 成功');
      } else {
        console.log('⚠️  send_profile_like 失败:', data.message);
        unsupportedApis.push('send_profile_like - ' + data.message);
      }
    }
  });

  test('get_friend_requests - 获取好友请求列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_friend_requests', {
      limit: 20,
      is_filtered: false
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_friend_requests 成功');
        console.log('   请求数量:', data.data.requests?.length || 0);
        expect(Array.isArray(data.data.requests)).toBe(true);
      } else {
        console.log('⚠️  get_friend_requests 失败:', data.message);
        unsupportedApis.push('get_friend_requests - ' + data.message);
      }
    }
  });

  test('accept_friend_request - 同意好友请求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'accept_friend_request', {
      request_id: 'test_request_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ accept_friend_request 成功');
      } else {
        console.log('⚠️  accept_friend_request 失败:', data.message);
        unsupportedApis.push('accept_friend_request - ' + data.message);
      }
    }
  });

  test('reject_friend_request - 拒绝好友请求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'reject_friend_request', {
      request_id: 'test_request_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ reject_friend_request 成功');
      } else {
        console.log('⚠️  reject_friend_request 失败:', data.message);
        unsupportedApis.push('reject_friend_request - ' + data.message);
      }
    }
  });
});

describe('Milky V1 - 群聊 API', () => {
  test('set_group_name - 设置群名称', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_name', {
      group_id: 123456789,
      new_group_name: 'Test Group'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_name 成功');
      } else {
        console.log('⚠️  set_group_name 失败:', data.message);
        unsupportedApis.push('set_group_name - ' + data.message);
      }
    }
  });

  test('get_group_member_list - 获取群成员列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_member_list', {
      group_id: 123456789,
      no_cache: false
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_member_list 成功');
        console.log('   成员数量:', data.data.members?.length || 0);
        expect(Array.isArray(data.data.members)).toBe(true);
      } else {
        console.log('⚠️  get_group_member_list 失败:', data.message);
        unsupportedApis.push('get_group_member_list - ' + data.message);
      }
    }
  });

  test('set_group_member_mute - 设置群成员禁言', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_member_mute', {
      group_id: 123456789,
      user_id: 987654321,
      duration: 0  // 0 表示取消禁言
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_member_mute 成功');
      } else {
        console.log('⚠️  set_group_member_mute 失败:', data.message);
        unsupportedApis.push('set_group_member_mute - ' + data.message);
      }
    }
  });

  test('get_group_announcements - 获取群公告列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_announcements', {
      group_id: 123456789
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_announcements 成功');
        console.log('   公告数量:', data.data.announcements?.length || 0);
        expect(Array.isArray(data.data.announcements)).toBe(true);
      } else {
        console.log('⚠️  get_group_announcements 失败:', data.message);
        unsupportedApis.push('get_group_announcements - ' + data.message);
      }
    }
  });

  test('send_group_nudge - 发送群戳一戳', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_group_nudge', {
      group_id: 123456789,
      user_id: 987654321
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_group_nudge 成功');
      } else {
        console.log('⚠️  send_group_nudge 失败:', data.message);
        unsupportedApis.push('send_group_nudge - ' + data.message);
      }
    }
  });

  test('get_group_notifications - 获取群通知列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试:服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_notifications', {
      is_filtered: false,
      limit: 20
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_notifications 成功');
        console.log('   通知数量:', data.data.notifications?.length || 0);
        expect(Array.isArray(data.data.notifications)).toBe(true);
      } else {
        console.log('⚠️  get_group_notifications 失败:', data.message);
        unsupportedApis.push('get_group_notifications - ' + data.message);
      }
    }
  });

  test('set_group_avatar - 设置群头像', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_avatar', {
      group_id: 123456789,
      file: 'base64://...'  // 实际应该是 base64 图片数据
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_avatar 成功');
      } else {
        console.log('⚠️  set_group_avatar 失败:', data.message);
        unsupportedApis.push('set_group_avatar - ' + data.message);
      }
    }
  });

  test('set_group_member_card - 设置群成员名片', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_member_card', {
      group_id: 123456789,
      user_id: 987654321,
      card: 'New Card Name'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_member_card 成功');
      } else {
        console.log('⚠️  set_group_member_card 失败:', data.message);
        unsupportedApis.push('set_group_member_card - ' + data.message);
      }
    }
  });

  test('set_group_member_special_title - 设置群成员专属头衔', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_member_special_title', {
      group_id: 123456789,
      user_id: 987654321,
      special_title: 'VIP',
      duration: -1  // -1 表示永久
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_member_special_title 成功');
      } else {
        console.log('⚠️  set_group_member_special_title 失败:', data.message);
        unsupportedApis.push('set_group_member_special_title - ' + data.message);
      }
    }
  });

  test('set_group_member_admin - 设置群管理员', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_member_admin', {
      group_id: 123456789,
      user_id: 987654321,
      enable: true
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_member_admin 成功');
      } else {
        console.log('⚠️  set_group_member_admin 失败:', data.message);
        unsupportedApis.push('set_group_member_admin - ' + data.message);
      }
    }
  });

  test('set_group_whole_mute - 设置群全体禁言', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_whole_mute', {
      group_id: 123456789,
      enable: false
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_whole_mute 成功');
      } else {
        console.log('⚠️  set_group_whole_mute 失败:', data.message);
        unsupportedApis.push('set_group_whole_mute - ' + data.message);
      }
    }
  });

  test('kick_group_member - 踢出群成员', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'kick_group_member', {
      group_id: 123456789,
      user_id: 987654321,
      reject_add_request: false
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ kick_group_member 成功');
      } else {
        console.log('⚠️  kick_group_member 失败:', data.message);
        unsupportedApis.push('kick_group_member - ' + data.message);
      }
    }
  });

  test('send_group_announcement - 发送群公告', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_group_announcement', {
      group_id: 123456789,
      content: 'Test Announcement'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_group_announcement 成功');
      } else {
        console.log('⚠️  send_group_announcement 失败:', data.message);
        unsupportedApis.push('send_group_announcement - ' + data.message);
      }
    }
  });

  test('delete_group_announcement - 删除群公告', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'delete_group_announcement', {
      group_id: 123456789,
      announcement_id: 'test_announcement_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ delete_group_announcement 成功');
      } else {
        console.log('⚠️  delete_group_announcement 失败:', data.message);
        unsupportedApis.push('delete_group_announcement - ' + data.message);
      }
    }
  });

  test('get_group_essence_messages - 获取群精华消息列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_essence_messages', {
      group_id: 123456789
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_essence_messages 成功');
        console.log('   精华消息数量:', data.data.messages?.length || 0);
        expect(Array.isArray(data.data.messages)).toBe(true);
      } else {
        console.log('⚠️  get_group_essence_messages 失败:', data.message);
        unsupportedApis.push('get_group_essence_messages - ' + data.message);
      }
    }
  });

  test('set_group_essence_message - 设置精华消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'set_group_essence_message', {
      group_id: 123456789,
      message_seq: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ set_group_essence_message 成功');
      } else {
        console.log('⚠️  set_group_essence_message 失败:', data.message);
        unsupportedApis.push('set_group_essence_message - ' + data.message);
      }
    }
  });

  test('delete_group_essence_message - 删除精华消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'delete_group_essence_message', {
      group_id: 123456789,
      message_seq: 1
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ delete_group_essence_message 成功');
      } else {
        console.log('⚠️  delete_group_essence_message 失败:', data.message);
        unsupportedApis.push('delete_group_essence_message - ' + data.message);
      }
    }
  });

  test('quit_group - 退出群聊', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'quit_group', {
      group_id: 123456789,
      is_dismiss: false
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ quit_group 成功');
      } else {
        console.log('⚠️  quit_group 失败:', data.message);
        unsupportedApis.push('quit_group - ' + data.message);
      }
    }
  });

  test('send_group_message_reaction - 发送群消息表情回应', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'send_group_message_reaction', {
      group_id: 123456789,
      message_seq: 1,
      face_id: 1  // 表情 ID
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ send_group_message_reaction 成功');
      } else {
        console.log('⚠️  send_group_message_reaction 失败:', data.message);
        unsupportedApis.push('send_group_message_reaction - ' + data.message);
      }
    }
  });

  test('accept_group_request - 同意加群请求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'accept_group_request', {
      request_id: 'test_request_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ accept_group_request 成功');
      } else {
        console.log('⚠️  accept_group_request 失败:', data.message);
        unsupportedApis.push('accept_group_request - ' + data.message);
      }
    }
  });

  test('reject_group_request - 拒绝加群请求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'reject_group_request', {
      request_id: 'test_request_id',
      reason: 'Not allowed'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ reject_group_request 成功');
      } else {
        console.log('⚠️  reject_group_request 失败:', data.message);
        unsupportedApis.push('reject_group_request - ' + data.message);
      }
    }
  });

  test('accept_group_invitation - 同意群邀请', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'accept_group_invitation', {
      request_id: 'test_invitation_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ accept_group_invitation 成功');
      } else {
        console.log('⚠️  accept_group_invitation 失败:', data.message);
        unsupportedApis.push('accept_group_invitation - ' + data.message);
      }
    }
  });

  test('reject_group_invitation - 拒绝群邀请', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'reject_group_invitation', {
      request_id: 'test_invitation_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ reject_group_invitation 成功');
      } else {
        console.log('⚠️  reject_group_invitation 失败:', data.message);
        unsupportedApis.push('reject_group_invitation - ' + data.message);
      }
    }
  });
});

describe('Milky V1 - 文件 API', () => {
  test('get_group_files - 获取群文件列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_files', {
      group_id: 123456789,
      parent_folder_id: '/'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_files 成功');
        console.log('   文件数量:', data.data.files?.length || 0);
        console.log('   文件夹数量:', data.data.folders?.length || 0);
        expect(Array.isArray(data.data.files)).toBe(true);
        expect(Array.isArray(data.data.folders)).toBe(true);
      } else {
        console.log('⚠️  get_group_files 失败:', data.message);
        unsupportedApis.push('get_group_files - ' + data.message);
      }
    }
  });

  test('create_group_folder - 创建群文件夹', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'create_group_folder', {
      group_id: 123456789,
      folder_name: 'Test Folder'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ create_group_folder 成功');
        expect(data.data.folder_id).toBeDefined();
      } else {
        console.log('⚠️  create_group_folder 失败:', data.message);
        unsupportedApis.push('create_group_folder - ' + data.message);
      }
    }
  });

  test('upload_private_file - 上传私聊文件', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'upload_private_file', {
      user_id: 123456789,
      file: 'base64://...',  // 实际应该是文件数据
      name: 'test.txt'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ upload_private_file 成功');
        expect(data.data.file_id).toBeDefined();
      } else {
        console.log('⚠️  upload_private_file 失败:', data.message);
        unsupportedApis.push('upload_private_file - ' + data.message);
      }
    }
  });

  test('upload_group_file - 上传群文件', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'upload_group_file', {
      group_id: 123456789,
      file: 'base64://...',  // 实际应该是文件数据
      name: 'test.txt',
      folder_id: '/'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ upload_group_file 成功');
        expect(data.data.file_id).toBeDefined();
      } else {
        console.log('⚠️  upload_group_file 失败:', data.message);
        unsupportedApis.push('upload_group_file - ' + data.message);
      }
    }
  });

  test('get_private_file_download_url - 获取私聊文件下载链接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_private_file_download_url', {
      user_id: 123456789,
      file_id: 'test_file_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_private_file_download_url 成功');
        expect(data.data.url).toBeDefined();
      } else {
        console.log('⚠️  get_private_file_download_url 失败:', data.message);
        unsupportedApis.push('get_private_file_download_url - ' + data.message);
      }
    }
  });

  test('get_group_file_download_url - 获取群文件下载链接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'get_group_file_download_url', {
      group_id: 123456789,
      file_id: 'test_file_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ get_group_file_download_url 成功');
        expect(data.data.url).toBeDefined();
      } else {
        console.log('⚠️  get_group_file_download_url 失败:', data.message);
        unsupportedApis.push('get_group_file_download_url - ' + data.message);
      }
    }
  });

  test('move_group_file - 移动群文件', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'move_group_file', {
      group_id: 123456789,
      file_id: 'test_file_id',
      parent_folder_id: '/target_folder'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ move_group_file 成功');
      } else {
        console.log('⚠️  move_group_file 失败:', data.message);
        unsupportedApis.push('move_group_file - ' + data.message);
      }
    }
  });

  test('rename_group_file - 重命名群文件', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'rename_group_file', {
      group_id: 123456789,
      file_id: 'test_file_id',
      new_name: 'renamed.txt'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ rename_group_file 成功');
      } else {
        console.log('⚠️  rename_group_file 失败:', data.message);
        unsupportedApis.push('rename_group_file - ' + data.message);
      }
    }
  });

  test('delete_group_file - 删除群文件', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'delete_group_file', {
      group_id: 123456789,
      file_id: 'test_file_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ delete_group_file 成功');
      } else {
        console.log('⚠️  delete_group_file 失败:', data.message);
        unsupportedApis.push('delete_group_file - ' + data.message);
      }
    }
  });

  test('rename_group_folder - 重命名群文件夹', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'rename_group_folder', {
      group_id: 123456789,
      folder_id: 'test_folder_id',
      new_name: 'Renamed Folder'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ rename_group_folder 成功');
      } else {
        console.log('⚠️  rename_group_folder 失败:', data.message);
        unsupportedApis.push('rename_group_folder - ' + data.message);
      }
    }
  });

  test('delete_group_folder - 删除群文件夹', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'delete_group_folder', {
      group_id: 123456789,
      folder_id: 'test_folder_id'
    });

    if (status === 200) {
      if (data.status === 'ok') {
        console.log('✅ delete_group_folder 成功');
      } else {
        console.log('⚠️  delete_group_folder 失败:', data.message);
        unsupportedApis.push('delete_group_folder - ' + data.message);
      }
    }
  });
});
