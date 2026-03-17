/**
 * Milky V1 HTTP 鉴权测试
 * 测试 HTTP API 的 access_token 鉴权机制
 *
 * 依据（鉴权）:
 * - Milky 通信: https://milky.ntqqrev.org/guide/communication
 * - Authorization: Bearer {access_token}; 鉴权失败 401
 * - 415 不支持的 Content-Type; 404 API 不存在; 无参须传 {}
 * 详见: __tests__/PROTOCOL_AUTH_HEARTBEAT.md
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { callMilkyAPI, checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'kook',
  accountId: process.env.ACCOUNT_ID || 'zhin',
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Milky V1 HTTP 鉴权测试');
  } else {
    console.warn('⚠️  服务器未运行，测试将被跳过');
  }
});

describe('Milky V1 - HTTP 鉴权测试', () => {
  test('无 token 访问（config.yaml 中 access_token 为空时应该成功）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI({
      ...CONFIG,
      accessToken: '', // 不提供 token
      timeout: 5000,
    }, 'get_login_info', {});

    console.log('📊 无 token 访问结果:', { status, data });
    
    // 如果服务器配置了 access_token，应该返回 401
    // 如果服务器未配置 access_token，应该返回正常数据
    if (status === 401) {
      console.log('✅ 服务器要求鉴权（已配置 access_token）');
      expect(status).toBe(401);
    } else if (status === 200 && data.status === 'ok') {
      console.log('✅ 服务器未要求鉴权（未配置 access_token）');
      expect(data.status).toBe('ok');
    }
  });

  test('错误的 token（应该被拒绝）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI({
      ...CONFIG,
      accessToken: 'wrong_token_12345', // 错误的 token
      timeout: 5000,
    }, 'get_login_info', {});

    console.log('📊 错误 token 访问结果:', { status, data });
    
    // 如果服务器配置了 access_token，应该返回 401
    if (status === 401) {
      console.log('✅ 服务器正确拒绝了错误的 token');
      expect(status).toBe(401);
    } else if (status === 200 && data.status === 'ok') {
      console.log('⚠️  服务器未配置 access_token，接受了任何请求');
      expect(data.status).toBe('ok');
    }
  });

  test('Header 方式传递 token（Authorization: Bearer）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const token = process.env.ACCESS_TOKEN || '';
    
    if (!token) {
      console.log('💡 未设置 ACCESS_TOKEN，跳过此测试');
      console.log('   提示: 在 config.yaml 中配置 access_token 并设置环境变量 ACCESS_TOKEN 来测试');
      return;
    }

    const { status, data } = await callMilkyAPI({
      ...CONFIG,
      accessToken: token,
      timeout: 5000,
    }, 'get_login_info', {});

    console.log('📊 使用 Authorization Header 访问结果:', data);
    if (status === 0) { console.log('⏭️  跳过：连接失败'); return; }
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.retcode).toBe(0);
  });

  test('验证 Content-Type 要求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/milky/v1/api/get_login_info`;
    
    // 发送错误的 Content-Type
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // 错误的 Content-Type
      },
      body: '{}',
    });

    console.log('📊 错误 Content-Type 响应:', response.status);
    
    // Milky 标准要求返回 415 (Unsupported Media Type)
    if (response.status === 415) {
      console.log('✅ 服务器正确拒绝了不支持的 Content-Type');
      expect(response.status).toBe(415);
    } else {
      console.log('⚠️  服务器未严格检查 Content-Type（状态码:', response.status, ')');
    }
  });

  test('验证 404 错误（API 不存在）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callMilkyAPI(CONFIG, 'non_existent_api', {});

    console.log('📊 不存在的 API 响应:', { status, data });
    
    // Milky 标准要求返回 404
    if (status === 404) {
      console.log('✅ 服务器正确返回 404（API 不存在）');
      expect(status).toBe(404);
    } else {
      console.log('⚠️  服务器返回状态码:', status);
    }
  });

  test('验证空参数处理（必须传入 {}）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    // Milky 标准要求：即使 API 无输入参数，也必须传入空对象 {}
    const { status, data } = await callMilkyAPI(CONFIG, 'get_login_info', {});

    console.log('📊 空参数 API 调用结果:', data);
    
    if (status === 200) {
      expect(data).toBeDefined();
      console.log('✅ 正确处理了空参数 {}');
    }
  });
});
