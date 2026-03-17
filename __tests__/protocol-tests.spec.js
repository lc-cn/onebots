/**
 * onebots 协议测试套件（Vitest 版本）
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';

// 配置 - 从环境变量或使用默认值
const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'kook',
  accountId: process.env.ACCOUNT_ID || 'zhin',
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
  const path = buildPath(protocol, version);
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

// 状态标志
let serverAvailable = false;
let accountAvailable = false;

// 辅助函数：检查测试前置条件
function skipIfNotReady(testName) {
  if (!serverAvailable) {
    console.log(`⏭️  跳过 ${testName}：服务器不可用`);
    return true;
  }
  if (!accountAvailable) {
    console.log(`⏭️  跳过 ${testName}：账号 ${CONFIG.platform}/${CONFIG.accountId} 不存在`);
    return true;
  }
  return false;
}

beforeAll(async () => {
  try {
    const response = await fetch(`${CONFIG.baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    serverAvailable = response.ok;
    if (serverAvailable) {
      console.log('✅ 服务器可用');
      
      // 检查账号是否存在
      const accountCheck = await fetch(
        `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/api/get_login_info`,
        { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(3000) 
        }
      );
      accountAvailable = accountCheck.status !== 404;
      if (accountAvailable) {
        console.log(`✅ 账号可用: ${CONFIG.platform}/${CONFIG.accountId}`);
      } else {
        console.warn(`⚠️  账号不存在: ${CONFIG.platform}/${CONFIG.accountId}，协议测试将被跳过`);
      }
    }
  } catch (error) {
    console.warn('⚠️  服务器未运行，某些测试将被跳过');
    serverAvailable = false;
  }
});

describe('onebots 协议测试', () => {
  test('配置信息', () => {
    console.log('\n配置信息:');
    console.log(`  服务器: ${CONFIG.baseUrl}`);
    console.log(`  平台: ${CONFIG.platform}`);
    console.log(`  账号: ${CONFIG.accountId}`);
    console.log(`  Token: ${CONFIG.accessToken ? '已配置' : '未配置'}`);
    console.log(`  URL 格式: /${CONFIG.platform}/${CONFIG.accountId}/{protocol}/{version}/:action`);
    console.log(`  服务器状态: ${serverAvailable ? '✅ 可用' : '❌ 不可用'}`);
    console.log(`  账号状态: ${accountAvailable ? '✅ 可用' : '❌ 不存在'}\n`);
    expect(CONFIG.baseUrl).toBeTruthy();
    expect(CONFIG.platform).toBeTruthy();
    expect(CONFIG.accountId).toBeTruthy();
  });
});

describe('OneBot V11 Protocol', () => {
  test('获取登录信息 - get_login_info', async () => {
    if (skipIfNotReady('get_login_info')) return;
    
    const { status, data, error } = await httpRequest('onebot', 'v11', 'get_login_info');
    
    expect(error).toBeUndefined();
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(data.data).toBeDefined();
    expect(data.data).toHaveProperty('user_id');
    expect(data.data).toHaveProperty('nickname');
  });
  
  test('发送私聊消息 - send_private_msg', async () => {
    if (skipIfNotReady('send_private_msg')) return;
    
    const { status, data, error } = await httpRequest('onebot', 'v11', 'send_private_msg', {
      user_id: 123456789,
      message: 'OneBot 11 测试消息',
    });
    
    expect(error).toBeUndefined();
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(data.data).toHaveProperty('message_id');
    }
  });
  
  test('获取好友列表 - get_friend_list', async () => {
    if (skipIfNotReady('get_friend_list')) return;
    
    const { status, data } = await httpRequest('onebot', 'v11', 'get_friend_list');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(Array.isArray(data.data)).toBe(true);
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('user_id');
        expect(data.data[0]).toHaveProperty('nickname');
      }
    }
  });
  
  test('获取群列表 - get_group_list', async () => {
    if (skipIfNotReady('get_group_list')) return;
    
    const { status, data } = await httpRequest('onebot', 'v11', 'get_group_list');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(Array.isArray(data.data)).toBe(true);
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('group_id');
        expect(data.data[0]).toHaveProperty('group_name');
      }
    }
  });
  
  test('获取版本信息 - get_version_info', async () => {
    if (skipIfNotReady('get_version_info')) return;
    
    const { status, data } = await httpRequest('onebot', 'v11', 'get_version_info');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
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
    if (skipIfNotReady('WebSocket V11')) return;
    
    const ws = createWebSocket('onebot', 'v11');
    
    await expect(waitForConnection(ws, 5000)).resolves.toBeUndefined();
    ws.close();
  }, 10000);
});

describe('OneBot V12 Protocol', () => {
  test('获取版本信息 - get_version', async () => {
    if (skipIfNotReady('get_version')) return;
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_version');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(data.data).toBeDefined();
    expect(data.data).toHaveProperty('impl');
    expect(data.data).toHaveProperty('version');
    expect(data.data).toHaveProperty('onebot_version');
    expect(data.data.onebot_version).toBe('12');
  });
  
  test('获取支持的动作列表 - get_supported_actions', async () => {
    if (skipIfNotReady('get_supported_actions')) return;
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_supported_actions');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(Array.isArray(data.data)).toBe(true);
    const actions = data.data.map(a => typeof a === 'string' ? a : a.action);
    expect(actions).toContain('get_version');
    expect(actions).toContain('get_supported_actions');
  });
  
  test('获取运行状态 - get_status', async () => {
    if (skipIfNotReady('get_status')) return;
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_status');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(data.data).toBeDefined();
    expect(data.data).toHaveProperty('good');
    expect(data.data).toHaveProperty('bots');
    expect(Array.isArray(data.data.bots)).toBe(true);
    if (data.data.bots.length > 0) {
      expect(data.data.bots[0]).toHaveProperty('online');
      expect(data.data.bots[0]).toHaveProperty('self');
    }
  });
  
  test('获取机器人自身信息 - get_self_info', async () => {
    if (skipIfNotReady('get_self_info')) return;
    
    const { status, data } = await httpRequest('onebot', 'v12', 'get_self_info');
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
    expect(data.data).toBeDefined();
    expect(data.data).toHaveProperty('user_id');
    expect(data.data).toHaveProperty('user_name');
  });
  
  test('发送消息 - send_message', async () => {
    if (skipIfNotReady('send_message')) return;
    
    const { status, data } = await httpRequest('onebot', 'v12', 'send_message', {
      detail_type: 'private',
      user_id: 'test_user_123',
      message: [
        { type: 'text', data: { text: 'OneBot 12 标准测试消息' } }
      ],
    });
    
    if (status === 0) { console.log("⏭️  跳过：连接失败"); return; }
      expect(status).toBe(200);
    expect(data).toBeDefined();
    if (data.status === 'ok') {
      expect(data.data).toHaveProperty('message_id');
      expect(data.data).toHaveProperty('time');
    }
  });
  
  test('WebSocket 正向连接', async () => {
    if (skipIfNotReady('WebSocket V12')) return;
    
    const ws = createWebSocket('onebot', 'v12');
    
    await expect(waitForConnection(ws, 5000)).resolves.toBeUndefined();
    ws.close();
  }, 10000);
});
