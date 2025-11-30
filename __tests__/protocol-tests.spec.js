/**
 * OneBots 协议测试套件（Vitest 版本）
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';

// 配置 - 从环境变量或使用默认值
const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  timeout: 10000,
};

// 辅助函数：构建完整路径
function buildPath(protocol, version, action = '') {
  return `/${CONFIG.platform}/${CONFIG.accountId}/${protocol}/${version}${action ? '/' + action : ''}`;
}

// 辅助函数：发送 HTTP 请求
async function httpRequest(protocol, version, action, body = {}) {
  const path = buildPath(protocol, version, action);
  const url = `${CONFIG.baseUrl}${path}`;
  
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (CONFIG.accessToken) {
    headers['Authorization'] = `Bearer ${CONFIG.accessToken}`;
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG.timeout),
    });
    
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { 
      status: 0, 
      error: error.message,
      data: null 
    };
  }
}

// 辅助函数：创建 WebSocket 连接
function createWebSocket(protocol, version) {
  const path = buildPath(protocol, version);  // WebSocket 直接在协议路径上
  let url = `${CONFIG.wsUrl}${path}`;
  
  if (CONFIG.accessToken) {
    url += `?access_token=${CONFIG.accessToken}`;
  }
  
  return new WebSocket(url);
}

// 辅助函数：等待 WebSocket 连接
function waitForConnection(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket 连接超时'));
    }, timeout);
    
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// 检查服务器是否可用
let serverAvailable = false;

beforeAll(async () => {
  try {
    const response = await fetch(`${CONFIG.baseUrl}/list`, {
      signal: AbortSignal.timeout(3000),
    });
    serverAvailable = response.ok || response.status === 401;
    if (serverAvailable) {
      console.log('✅ 服务器可用，将执行所有测试');
    }
  } catch (error) {
    console.warn('⚠️  服务器未运行，某些测试将被跳过');
    serverAvailable = false;
  }
});

describe('OneBots 协议测试', () => {
  test('配置信息', () => {
    console.log('\n配置信息:');
    console.log(`  服务器: ${CONFIG.baseUrl}`);
    console.log(`  平台: ${CONFIG.platform}`);
    console.log(`  账号: ${CONFIG.accountId}`);
    console.log(`  Token: ${CONFIG.accessToken ? '已配置' : '未配置'}`);
    console.log(`  URL 格式: /${CONFIG.platform}/${CONFIG.accountId}/{protocol}/{version}/:action`);
    console.log(`  服务器状态: ${serverAvailable ? '✅ 可用' : '❌ 不可用'}\n`);
    expect(CONFIG.baseUrl).toBeTruthy();
    expect(CONFIG.platform).toBeTruthy();
    expect(CONFIG.accountId).toBeTruthy();
  });
});

describe('OneBot V11 Protocol', () => {
  test('获取登录信息 - get_login_info', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data, error } = await httpRequest('onebot', 'v11', 'get_login_info');
    
    expect(error).toBeUndefined();
    expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(data.data).toBeDefined();
    // 验证响应数据格式符合 OneBot 11 标准
    expect(data.data).toHaveProperty('user_id');
    expect(data.data).toHaveProperty('nickname');
  });
  
  test('发送私聊消息 - send_private_msg', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data, error } = await httpRequest('onebot', 'v11', 'send_private_msg', {
      user_id: 123456789,
      message: 'OneBot 11 测试消息',
    });
    
    expect(error).toBeUndefined();
    expect(status).toBe(200);
    expect(data).toBeDefined();
    // 允许返回成功或失败（钉钉可能不支持私聊）
    if (data.status === 'ok') {
      expect(data.data).toHaveProperty('message_id');
    }
  });
  
  test('获取好友列表 - get_friend_list', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v11', 'get_friend_list');
    
    expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(Array.isArray(data.data)).toBe(true);
      // 如果有好友，验证格式
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('user_id');
        expect(data.data[0]).toHaveProperty('nickname');
      }
    }
  });
  
  test('获取群列表 - get_group_list', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v11', 'get_group_list');
    
    expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(Array.isArray(data.data)).toBe(true);
      // 如果有群组，验证格式
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('group_id');
        expect(data.data[0]).toHaveProperty('group_name');
      }
    }
  });
  
  test('获取版本信息 - get_version_info', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v11', 'get_version_info');
    
    expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(data.data).toHaveProperty('app_name');
      expect(data.data).toHaveProperty('app_version');
      expect(data.data).toHaveProperty('protocol_version');
      expect(data.data.protocol_version).toBe('v11');
    }
  });
  
  test('WebSocket 正向连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    const ws = createWebSocket('onebot', 'v11');
    
    await expect(waitForConnection(ws, 5000)).resolves.toBeUndefined();
    ws.close();
  }, 10000);
});

describe('OneBot V12 Protocol', () => {
  test('获取版本信息 - get_version', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_version');
    
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
  
  test('获取支持的动作列表 - get_supported_actions', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_supported_actions');
    
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
  
  test('获取运行状态 - get_status', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_status');
    
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
  
  test('获取机器人自身信息 - get_self_info', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_self_info');
    
    expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(data.data).toBeDefined();
    expect(data.data).toHaveProperty('user_id');
    expect(data.data).toHaveProperty('user_name');
  });
  
  test('发送消息 - send_message', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    const { status, data } = await httpRequest('onebot', 'v12', 'send_message', {
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
    }
  });
  
  test('WebSocket 正向连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    const ws = createWebSocket('onebot', 'v12');
    
    await expect(waitForConnection(ws, 5000)).resolves.toBeUndefined();
    ws.close();
  }, 10000);
});
