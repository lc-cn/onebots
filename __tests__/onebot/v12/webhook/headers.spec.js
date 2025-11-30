/**
 * OneBot 12 HTTP Webhook 请求头测试
 * 测试 HTTP Webhook 的请求头是否符合 OneBot 12 标准
 * 参考: https://12.onebot.dev/connect/communication/http-webhook/
 * 
 * 必需的请求头:
 * - Content-Type: application/json
 * - User-Agent: 如 OneBot/12 (qq) Go-LibOneBot/1.0.0
 * - X-OneBot-Version: 12
 * - X-Impl: 实现名称
 * - Authorization: Bearer <access_token> (如果配置了 access_token)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  webhookPort: 18085, // 使用不同的端口
  accessToken: process.env.ACCESS_TOKEN || '',
};

let serverAvailable = false;
let webhookServer = null;
let receivedRequests = [];

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V12 WebHook 请求头测试');
    console.log(`⚙️  启动 WebHook 服务器在端口 ${CONFIG.webhookPort}`);
    webhookServer = await createWebhookServerWithHeaders(CONFIG.webhookPort);
  } else {
    console.warn('⚠️  服务器未运行，测试将被跳过');
  }
});

afterAll(async () => {
  if (webhookServer) {
    await webhookServer.close();
    console.log('🔌 WebHook 服务器已关闭');
  }
});

/**
 * 创建能捕获请求头的 WebHook 服务器
 */
function createWebhookServerWithHeaders(port) {
  const requests = receivedRequests;
  
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
            const event = JSON.parse(body);
            requests.push({
              timestamp: Date.now(),
              headers: req.headers,
              body: event,
              url: req.url,
            });
            
            // 返回 204 表示成功
            res.writeHead(204);
            res.end();
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    server.on('error', reject);
    
    server.listen(port, () => {
      resolve({
        server,
        requests,
        close: () => new Promise((resolve) => server.close(resolve))
      });
    });
  });
}

describe('OneBot V12 - HTTP Webhook 请求头测试', () => {
  test('配置说明', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📝 OneBot V12 HTTP Webhook 请求头测试配置');
    console.log('='.repeat(70));
    console.log('在 config.yaml 中添加以下配置:');
    console.log('');
    console.log('dingtalk.dingl4hqvwwxewpk6tcn:');
    console.log('  onebot.v12:');
    console.log(`    webhook: ["http://localhost:${CONFIG.webhookPort}"]`);
    console.log('');
    console.log('OneBot 12 标准要求的请求头:');
    console.log('  ✓ Content-Type: application/json');
    console.log('  ✓ User-Agent: OneBot/12 (<impl>) <software>');
    console.log('  ✓ X-OneBot-Version: 12');
    console.log('  ✓ X-Impl: <实现名称>');
    console.log('  ✓ Authorization: Bearer <access_token> (可选)');
    console.log('='.repeat(70) + '\n');
  });

  test('等待接收 WebHook 请求', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    console.log('⏳ 等待 10 秒以接收 WebHook 推送...');
    console.log(`💡 提示: 需要在 config.yaml 中配置 webhook: ["http://localhost:${CONFIG.webhookPort}"]`);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    if (receivedRequests.length === 0) {
      console.log('⚠️  未接收到 WebHook 请求');
      console.log('📌 请确保:');
      console.log('   1. 已在 config.yaml 中配置 webhook');
      console.log(`   2. URL 指向 http://localhost:${CONFIG.webhookPort}`);
      console.log('   3. 服务器已重启');
      return;
    }
    
    console.log(`✅ 接收到 ${receivedRequests.length} 个 WebHook 请求\n`);
    expect(receivedRequests.length).toBeGreaterThan(0);
  }, 15000);

  test('验证 Content-Type 请求头', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (receivedRequests.length === 0) {
      console.log('⏭️  跳过测试：没有接收到请求');
      return;
    }

    const firstRequest = receivedRequests[0];
    const contentType = firstRequest.headers['content-type'];
    
    console.log('📊 Content-Type:', contentType);
    
    expect(contentType).toBeDefined();
    expect(contentType).toContain('application/json');
    console.log('✅ Content-Type 符合标准');
  });

  test('验证 User-Agent 请求头', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (receivedRequests.length === 0) {
      console.log('⏭️  跳过测试：没有接收到请求');
      return;
    }

    const firstRequest = receivedRequests[0];
    const userAgent = firstRequest.headers['user-agent'];
    
    console.log('📊 User-Agent:', userAgent);
    
    expect(userAgent).toBeDefined();
    expect(userAgent.length).toBeGreaterThan(0);
    
    // 建议格式: OneBot/12 (impl) software/version
    if (userAgent.includes('OneBot')) {
      console.log('✅ User-Agent 包含 OneBot 标识');
    } else {
      console.log('⚠️  User-Agent 未包含 OneBot 标识（建议格式: OneBot/12 (impl) software/version）');
    }
  });

  test('验证 X-OneBot-Version 请求头', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (receivedRequests.length === 0) {
      console.log('⏭️  跳过测试：没有接收到请求');
      return;
    }

    const firstRequest = receivedRequests[0];
    const onebotVersion = firstRequest.headers['x-onebot-version'];
    
    console.log('📊 X-OneBot-Version:', onebotVersion);
    
    expect(onebotVersion).toBeDefined();
    expect(onebotVersion).toBe('12');
    console.log('✅ X-OneBot-Version 符合标准（值为 12）');
  });

  test('验证 X-Impl 请求头', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (receivedRequests.length === 0) {
      console.log('⏭️  跳过测试：没有接收到请求');
      return;
    }

    const firstRequest = receivedRequests[0];
    const impl = firstRequest.headers['x-impl'];
    
    console.log('📊 X-Impl:', impl);
    
    expect(impl).toBeDefined();
    expect(impl.length).toBeGreaterThan(0);
    console.log('✅ X-Impl 请求头存在');
    
    // 验证格式（应该是实现名称，如 "onebots"）
    if (/^[a-z0-9_-]+$/.test(impl)) {
      console.log('✅ X-Impl 格式符合标准（小写字母、数字、下划线、连字符）');
    } else {
      console.log('⚠️  X-Impl 格式可能不符合建议（应为小写字母、数字、下划线、连字符）');
    }
  });

  test('验证 Authorization 请求头（如果配置了 access_token）', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (receivedRequests.length === 0) {
      console.log('⏭️  跳过测试：没有接收到请求');
      return;
    }

    const firstRequest = receivedRequests[0];
    const authorization = firstRequest.headers['authorization'];
    
    console.log('📊 Authorization:', authorization || '(未设置)');
    
    if (CONFIG.accessToken) {
      // 如果设置了 ACCESS_TOKEN 环境变量，应该有 Authorization 头
      expect(authorization).toBeDefined();
      expect(authorization).toMatch(/^Bearer .+/);
      console.log('✅ Authorization 请求头格式正确');
    } else {
      if (authorization) {
        console.log('✅ 服务器配置了 access_token 并发送了 Authorization 请求头');
      } else {
        console.log('💡 未配置 access_token，没有 Authorization 请求头（这是正常的）');
      }
    }
  });

  test('完整请求头摘要', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (receivedRequests.length === 0) {
      console.log('⏭️  跳过测试：没有接收到请求');
      return;
    }

    const firstRequest = receivedRequests[0];
    
    console.log('\n' + '='.repeat(70));
    console.log('📋 完整请求头摘要');
    console.log('='.repeat(70));
    
    const headers = {
      'Content-Type': firstRequest.headers['content-type'],
      'User-Agent': firstRequest.headers['user-agent'],
      'X-OneBot-Version': firstRequest.headers['x-onebot-version'],
      'X-Impl': firstRequest.headers['x-impl'],
      'Authorization': firstRequest.headers['authorization'] || '(未设置)',
    };
    
    Object.entries(headers).forEach(([key, value]) => {
      const status = value && value !== '(未设置)' ? '✅' : '❌';
      console.log(`${status} ${key}: ${value}`);
    });
    
    console.log('='.repeat(70) + '\n');
    
    // 验证所有必需的请求头
    expect(firstRequest.headers['content-type']).toBeDefined();
    expect(firstRequest.headers['user-agent']).toBeDefined();
    expect(firstRequest.headers['x-onebot-version']).toBe('12');
    expect(firstRequest.headers['x-impl']).toBeDefined();
  });
});
