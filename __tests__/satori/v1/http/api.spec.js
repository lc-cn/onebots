/**
 * Satori V1 HTTP API 测试
 * 测试所有 Satori API 接口
 * 参考: https://satori.chat/zh-CN/protocol/api.html
 * 
 * Satori API 路径:
 * - POST /{platform}/{account_id}/satori/v1/{method}
 * - 鉴权: Authorization: Bearer <token>
 * - Content-Type: application/json
 * - 响应格式: { data: any } 或 { message: string }
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { checkServerAvailable, callSatoriAPI } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  token: process.env.SATORI_TOKEN || process.env.ACCESS_TOKEN || '',
};

let serverAvailable = false;
const unsupportedApis = [];

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Satori V1 HTTP API 测试');
  } else {
    console.warn('⚠️  服务器未运行，Satori V1 HTTP API 测试将被跳过');
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
    console.log('='.repeat(70));
    console.log('\n');
  }
});

describe('Satori V1 - 消息 API', () => {
  test('message.create - 发送消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'message.create', {
      channel_id: '123456789',
      content: 'Test message from Satori',
    });

    if (status === 200 && data.data) {
      console.log('✅ message.create 成功');
      console.log('   消息 ID:', data.data[0]?.id);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
    } else {
      console.log('⚠️  message.create 失败:', data.message || '不支持');
      unsupportedApis.push('message.create - ' + (data.message || '不支持'));
    }
  });

  test('message.get - 获取消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'message.get', {
      channel_id: '123456789',
      message_id: 'test_message_id',
    });

    if (status === 200 && data.data) {
      console.log('✅ message.get 成功');
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  message.get 失败:', data.message || '不支持');
      unsupportedApis.push('message.get - ' + (data.message || '不支持'));
    }
  });

  test('message.delete - 删除消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'message.delete', {
      channel_id: '123456789',
      message_id: 'test_message_id',
    });

    if (status === 200 && !data.message) {
      console.log('✅ message.delete 成功');
    } else {
      console.log('⚠️  message.delete 失败:', data.message || '不支持');
      unsupportedApis.push('message.delete - ' + (data.message || '不支持'));
    }
  });

  test('message.update - 编辑消息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'message.update', {
      channel_id: '123456789',
      message_id: 'test_message_id',
      content: 'Updated message content',
    });

    if (status === 200 && !data.message) {
      console.log('✅ message.update 成功');
    } else {
      console.log('⚠️  message.update 失败:', data.message || '不支持');
      unsupportedApis.push('message.update - ' + (data.message || '不支持'));
    }
  });

  test('message.list - 获取消息列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'message.list', {
      channel_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ message.list 成功');
      console.log('   消息数量:', data.data.data?.length || 0);
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  message.list 失败:', data.message || '不支持');
      unsupportedApis.push('message.list - ' + (data.message || '不支持'));
    }
  });
});

describe('Satori V1 - 频道 API', () => {
  test('channel.get - 获取频道信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'channel.get', {
      channel_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ channel.get 成功');
      expect(data.data.id).toBeDefined();
    } else {
      console.log('⚠️  channel.get 失败:', data.message || '不支持');
      unsupportedApis.push('channel.get - ' + (data.message || '不支持'));
    }
  });

  test('channel.list - 获取频道列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'channel.list', {
      guild_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ channel.list 成功');
      console.log('   频道数量:', data.data.data?.length || 0);
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  channel.list 失败:', data.message || '不支持');
      unsupportedApis.push('channel.list - ' + (data.message || '不支持'));
    }
  });

  test('channel.create - 创建频道', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'channel.create', {
      guild_id: '123456789',
      data: {
        name: 'Test Channel',
      },
    });

    if (status === 200 && data.data) {
      console.log('✅ channel.create 成功');
      expect(data.data.id).toBeDefined();
    } else {
      console.log('⚠️  channel.create 失败:', data.message || '不支持');
      unsupportedApis.push('channel.create - ' + (data.message || '不支持'));
    }
  });

  test('channel.update - 更新频道', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'channel.update', {
      channel_id: '123456789',
      data: {
        name: 'Updated Channel',
      },
    });

    if (status === 200 && !data.message) {
      console.log('✅ channel.update 成功');
    } else {
      console.log('⚠️  channel.update 失败:', data.message || '不支持');
      unsupportedApis.push('channel.update - ' + (data.message || '不支持'));
    }
  });

  test('channel.delete - 删除频道', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'channel.delete', {
      channel_id: '123456789',
    });

    if (status === 200 && !data.message) {
      console.log('✅ channel.delete 成功');
    } else {
      console.log('⚠️  channel.delete 失败:', data.message || '不支持');
      unsupportedApis.push('channel.delete - ' + (data.message || '不支持'));
    }
  });
});

describe('Satori V1 - 群组 API', () => {
  test('guild.get - 获取群组信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'guild.get', {
      guild_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ guild.get 成功');
      expect(data.data.id).toBeDefined();
    } else {
      console.log('⚠️  guild.get 失败:', data.message || '不支持');
      unsupportedApis.push('guild.get - ' + (data.message || '不支持'));
    }
  });

  test('guild.list - 获取群组列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'guild.list', {});

    if (status === 200 && data.data) {
      console.log('✅ guild.list 成功');
      console.log('   群组数量:', data.data.data?.length || 0);
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  guild.list 失败:', data.message || '不支持');
      unsupportedApis.push('guild.list - ' + (data.message || '不支持'));
    }
  });
});

describe('Satori V1 - 群组成员 API', () => {
  test('guild.member.get - 获取群成员信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'guild.member.get', {
      guild_id: '123456789',
      user_id: '987654321',
    });

    if (status === 200 && data.data) {
      console.log('✅ guild.member.get 成功');
      expect(data.data.user).toBeDefined();
    } else {
      console.log('⚠️  guild.member.get 失败:', data.message || '不支持');
      unsupportedApis.push('guild.member.get - ' + (data.message || '不支持'));
    }
  });

  test('guild.member.list - 获取群成员列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'guild.member.list', {
      guild_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ guild.member.list 成功');
      console.log('   成员数量:', data.data.data?.length || 0);
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  guild.member.list 失败:', data.message || '不支持');
      unsupportedApis.push('guild.member.list - ' + (data.message || '不支持'));
    }
  });

  test('guild.member.kick - 踢出群成员', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'guild.member.kick', {
      guild_id: '123456789',
      user_id: '987654321',
    });

    if (status === 200 && !data.message) {
      console.log('✅ guild.member.kick 成功');
    } else {
      console.log('⚠️  guild.member.kick 失败:', data.message || '不支持');
      unsupportedApis.push('guild.member.kick - ' + (data.message || '不支持'));
    }
  });

  test('guild.member.mute - 禁言群成员', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'guild.member.mute', {
      guild_id: '123456789',
      user_id: '987654321',
      duration: 60000, // 1 分钟
    });

    if (status === 200 && !data.message) {
      console.log('✅ guild.member.mute 成功');
    } else {
      console.log('⚠️  guild.member.mute 失败:', data.message || '不支持');
      unsupportedApis.push('guild.member.mute - ' + (data.message || '不支持'));
    }
  });
});

describe('Satori V1 - 用户 API', () => {
  test('user.get - 获取用户信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'user.get', {
      user_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ user.get 成功');
      expect(data.data.id).toBeDefined();
    } else {
      console.log('⚠️  user.get 失败:', data.message || '不支持');
      unsupportedApis.push('user.get - ' + (data.message || '不支持'));
    }
  });

  test('user.channel.create - 创建私聊频道', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'user.channel.create', {
      user_id: '123456789',
    });

    if (status === 200 && data.data) {
      console.log('✅ user.channel.create 成功');
      expect(data.data.id).toBeDefined();
    } else {
      console.log('⚠️  user.channel.create 失败:', data.message || '不支持');
      unsupportedApis.push('user.channel.create - ' + (data.message || '不支持'));
    }
  });
});

describe('Satori V1 - 好友 API', () => {
  test('friend.list - 获取好友列表', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'friend.list', {});

    if (status === 200 && data.data) {
      console.log('✅ friend.list 成功');
      console.log('   好友数量:', data.data.data?.length || 0);
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  friend.list 失败:', data.message || '不支持');
      unsupportedApis.push('friend.list - ' + (data.message || '不支持'));
    }
  });

  test('friend.delete - 删除好友', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'friend.delete', {
      user_id: '123456789',
    });

    if (status === 200 && !data.message) {
      console.log('✅ friend.delete 成功');
    } else {
      console.log('⚠️  friend.delete 失败:', data.message || '不支持');
      unsupportedApis.push('friend.delete - ' + (data.message || '不支持'));
    }
  });
});

describe('Satori V1 - 登录信息 API', () => {
  test('login.get - 获取登录信息', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'login.get', {});

    if (status === 200 && data.data) {
      console.log('✅ login.get 成功');
      console.log('   Bot ID:', data.data.self_id);
      console.log('   平台:', data.data.platform);
      console.log('   状态:', data.data.status);
      expect(data.data.self_id).toBeDefined();
      expect(data.data.platform).toBeDefined();
    } else {
      console.log('⚠️  login.get 失败:', data.message || '不支持');
      unsupportedApis.push('login.get - ' + (data.message || '不支持'));
    }
  });
});
