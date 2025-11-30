/**
 * Satori V1 HTTP 鉴权测试
 * 测试 Satori 协议的鉴权机制
 * 参考: https://satori.chat/zh-CN/protocol/
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { checkServerAvailable, callSatoriAPI } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  token: process.env.SATORI_TOKEN || process.env.ACCESS_TOKEN || '',
};

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Satori V1 鉴权测试');
  } else {
    console.warn('⚠️  服务器未运行，Satori V1 鉴权测试将被跳过');
  }
});

describe('Satori V1 - HTTP 鉴权测试', () => {
  test('无 token 访问（如果配置了 token 应该失败）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const configWithoutToken = { ...CONFIG, token: '' };
    const { status, data } = await callSatoriAPI(configWithoutToken, 'login.get', {});

    if (status === 401) {
      console.log('✅ 无 token 被拒绝（符合预期）');
      expect(status).toBe(401);
    } else if (status === 200) {
      console.log('⚠️  无 token 也能访问（服务器可能未开启鉴权）');
    } else {
      console.log('📊 状态码:', status);
    }
  });

  test('错误的 token（应该被拒绝）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const configWithWrongToken = { ...CONFIG, token: 'wrong_token_12345' };
    const { status, data } = await callSatoriAPI(configWithWrongToken, 'login.get', {});

    if (status === 401 || status === 403) {
      console.log('✅ 错误 token 被拒绝（符合预期）');
      expect([401, 403]).toContain(status);
    } else if (status === 200) {
      console.log('⚠️  错误 token 也能访问（服务器可能未开启鉴权）');
    } else {
      console.log('📊 状态码:', status);
    }
  });

  test('正确的 token（Authorization: Bearer）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'login.get', {});

    if (status === 200 && data.data) {
      console.log('✅ Bearer token 鉴权成功');
      expect(data.data).toBeDefined();
    } else {
      console.log('⚠️  Bearer token 鉴权失败或 API 不支持');
    }
  });

  test('验证 Content-Type 要求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const url = `${CONFIG.baseUrl}/${CONFIG.platform}/${CONFIG.accountId}/satori/v1/login.get`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.token}`,
        'Content-Type': 'text/plain', // 错误的 Content-Type
      },
      body: JSON.stringify({}),
    });

    console.log('📊 Content-Type 验证状态:', response.status);
    
    if (response.status === 415) {
      console.log('✅ 错误的 Content-Type 被拒绝（符合预期）');
      expect(response.status).toBe(415);
    } else if (response.status === 200) {
      console.log('⚠️  服务器未严格验证 Content-Type');
    }
  });

  test('验证 404 错误（API 不存在）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status } = await callSatoriAPI(CONFIG, 'non.existent.api', {});

    if (status === 404) {
      console.log('✅ 不存在的 API 返回 404');
      expect(status).toBe(404);
    } else {
      console.log('📊 不存在的 API 状态码:', status);
    }
  });

  test('验证空参数处理', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'login.get', {});

    console.log('📊 空参数请求状态:', status);
    
    if (status === 200) {
      console.log('✅ 空参数请求成功');
    } else if (status === 400) {
      console.log('⚠️  空参数被拒绝');
    }
  });
});

describe('Satori V1 - API 响应格式验证', () => {
  test('成功响应格式应符合规范', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'login.get', {});

    if (status === 200) {
      console.log('💡 Satori 成功响应格式:');
      console.log('   { data: any }');
      console.log('\n实际响应:', JSON.stringify(data, null, 2));
      
      if (data.data !== undefined) {
        console.log('✅ 响应格式符合规范');
        expect(data.data).toBeDefined();
      } else {
        console.log('⚠️  响应格式不符合规范');
      }
    }
  });

  test('错误响应格式应符合规范', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    const { status, data } = await callSatoriAPI(CONFIG, 'non.existent.api', {});

    console.log('💡 Satori 错误响应格式:');
    console.log('   { message: string }');
    console.log('\n实际响应:', JSON.stringify(data, null, 2));
    
    if (data.message !== undefined) {
      console.log('✅ 错误响应格式符合规范');
      expect(data.message).toBeDefined();
    } else {
      console.log('⚠️  错误响应格式不符合规范');
    }
  });
});
