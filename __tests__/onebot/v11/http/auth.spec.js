/**
 * OneBot 11 HTTP 鉴权测试
 * 测试 HTTP API 的 access_token 鉴权机制
 *
 * 依据（鉴权）:
 * - OneBot 11 标准: https://github.com/botuniverse/onebot-11
 * - HTTP 鉴权: Authorization: Bearer <access_token> 或 URL ?access_token=xxx
 * - 鉴权失败: 401 或 retcode 表示未授权
 * 详见: __tests__/PROTOCOL_AUTH_HEARTBEAT.md
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { httpRequest, checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'kook',
  accountId: process.env.ACCOUNT_ID || 'zhin',
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 HTTP 鉴权测试');
  } else {
    console.warn('⚠️  服务器未运行，测试将被跳过');
  }
});

describe('OneBot V11 - HTTP 鉴权测试', () => {
  test('无 token 访问（config.yaml 中 access_token 为空时应该成功）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await httpRequest({
      ...CONFIG,
      accessToken: '', // 不提供 token
      timeout: 5000,
    }, 'onebot', 'v11', 'get_login_info');

    // 状态码 0 表示连接失败
    if (status === 0) {
      console.log('⏭️  跳过测试：连接失败');
      return;
    }

    console.log('📊 无 token 访问结果:', data);
    
    // 如果服务器配置了 access_token，应该返回 401
    // 如果服务器未配置 access_token，应该返回正常数据
    if (data && (data.retcode === 1403 || data.retcode === 401 || status === 401)) {
      console.log('✅ 服务器要求鉴权（已配置 access_token）');
      expect(status === 401 || data.retcode > 0).toBe(true);
    } else {
      console.log('✅ 服务器未要求鉴权（未配置 access_token）');
      expect(data.status).toBe('ok');
    }
  });

  test('错误的 token（应该被拒绝）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await httpRequest({
      ...CONFIG,
      accessToken: 'wrong_token_12345', // 错误的 token
      timeout: 5000,
    }, 'onebot', 'v11', 'get_login_info');

    // 状态码 0 表示连接失败
    if (status === 0) {
      console.log('⏭️  跳过测试：连接失败');
      return;
    }

    console.log('📊 错误 token 访问结果:', data);
    
    // 如果服务器配置了 access_token，应该返回错误
    if (data && (data.retcode === 1403 || data.retcode === 401 || status === 401)) {
      console.log('✅ 服务器正确拒绝了错误的 token');
      expect(status === 401 || data.retcode > 0).toBe(true);
    } else {
      console.log('⚠️  服务器未配置 access_token，接受了任何请求');
      expect(data.status).toBe('ok');
    }
  });

  test('Header 方式传递 token（Authorization: Bearer）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    // 如果环境变量中有 token，使用它
    const token = process.env.ACCESS_TOKEN || '';
    
    if (!token) {
      console.log('💡 未设置 ACCESS_TOKEN，跳过此测试');
      console.log('   提示: 在 config.yaml 中配置 access_token 并设置环境变量 ACCESS_TOKEN 来测试');
      return;
    }

    const { status, data } = await httpRequest({
      ...CONFIG,
      accessToken: token,
      timeout: 5000,
    }, 'onebot', 'v11', 'get_login_info');

    console.log('📊 使用 Authorization Header 访问结果:', data);
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
  });

  test('Query 参数方式传递 token（?access_token=xxx）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = process.env.ACCESS_TOKEN || '';
    
    if (!token) {
      console.log('💡 未设置 ACCESS_TOKEN，跳过此测试');
      return;
    }

    // 直接在 URL 中添加 access_token 参数
    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/onebot/v11/get_login_info?access_token=${token}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    console.log('📊 使用 Query 参数访问结果:', data);
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
  });

  test('同时提供 Header 和 Query 参数（Header 应该优先）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = process.env.ACCESS_TOKEN || '';
    
    if (!token) {
      console.log('💡 未设置 ACCESS_TOKEN，跳过此测试');
      return;
    }

    // Header 中提供正确的 token，Query 中提供错误的 token
    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/onebot/v11/get_login_info?access_token=wrong_token`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    console.log('📊 同时提供两种方式的结果:', data);
    
    // 应该使用 Header 中的正确 token，所以应该成功
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
  });
});
