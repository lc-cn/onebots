/**
 * OneBot 11 HTTP Reverse (WebHook) 鉴权测试
 * 测试 WebHook 推送时的签名验证机制
 * 参考: https://github.com/botuniverse/onebot-11/blob/master/communication/http-post.md
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { createWebhookServer } from '../../utils/test-server.js';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  webhookPort: 18083, // 使用不同的端口避免冲突
  secret: process.env.WEBHOOK_SECRET || '', // WebHook 签名密钥
};

let serverAvailable = false;
let webhookServer = null;
let receivedHeaders = null;

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 OneBot V11 WebHook 鉴权测试');
    console.log(`⚙️  启动 WebHook 服务器在端口 ${CONFIG.webhookPort}`);
    
    // 创建增强的 WebHook 服务器，捕获请求头
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
  const events = [];
  const headers = [];
  
  return new Promise((resolve, reject) => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        
        // 保存请求头
        headers.push({
          timestamp: Date.now(),
          headers: req.headers,
        });
        
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
            const event = JSON.parse(body);
            events.push({
              event,
              headers: req.headers,
              body,
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
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
        events,
        headers,
        close: () => new Promise((resolve) => server.close(resolve))
      });
    });
  });
}

describe('OneBot V11 - WebHook 鉴权测试', () => {
  test('配置说明', () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('📝 OneBot V11 WebHook 鉴权测试配置');
    console.log('='.repeat(70));
    console.log('在 config.yaml 中配置签名密钥:');
    console.log('');
    console.log('general:');
    console.log('  onebot.v11:');
    console.log('    secret: "your_secret_key"  # 签名密钥');
    console.log(`    http_reverse: ["http://localhost:${CONFIG.webhookPort}"]`);
    console.log('');
    console.log('配置后，OneBots 会在推送事件时添加 X-Signature 请求头');
    console.log('格式: X-Signature: sha1=<HMAC-SHA1签名>');
    console.log('='.repeat(70) + '\n');
  });

  test('检查 WebHook 请求头', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    console.log('⏳ 等待 10 秒以接收 WebHook 事件...');
    console.log(`💡 提示: 需要在 config.yaml 中配置 http_reverse: ["http://localhost:${CONFIG.webhookPort}"]`);
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    if (webhookServer.events.length === 0) {
      console.log('⚠️  未接收到事件');
      console.log('📌 请确保:');
      console.log('   1. 已在 config.yaml 中配置 http_reverse');
      console.log(`   2. URL 指向 http://localhost:${CONFIG.webhookPort}`);
      console.log('   3. 服务器已重启');
      return;
    }
    
    const firstEvent = webhookServer.events[0];
    console.log('\n📨 收到的请求头:');
    console.log(JSON.stringify(firstEvent.headers, null, 2));
    
    expect(firstEvent.headers).toBeDefined();
    expect(firstEvent.headers['content-type']).toContain('application/json');
  }, 15000);

  test('验证 X-Signature 签名（如果配置了 secret）', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (webhookServer.events.length === 0) {
      console.log('⏭️  跳过测试：没有接收到事件');
      return;
    }

    const firstEvent = webhookServer.events[0];
    const signature = firstEvent.headers['x-signature'];
    
    if (!signature) {
      console.log('💡 未检测到 X-Signature 请求头');
      console.log('   提示: 在 config.yaml 中配置 secret 来启用签名验证');
      return;
    }
    
    console.log('✅ 检测到 X-Signature:', signature);
    
    if (!CONFIG.secret) {
      console.log('⚠️  未设置环境变量 WEBHOOK_SECRET，无法验证签名');
      console.log('   提示: 设置 WEBHOOK_SECRET 环境变量为 config.yaml 中的 secret 值');
      return;
    }
    
    // 验证签名
    const hmac = crypto.createHmac('sha1', CONFIG.secret);
    hmac.update(firstEvent.body);
    const expectedSignature = 'sha1=' + hmac.digest('hex');
    
    console.log('📊 预期签名:', expectedSignature);
    console.log('📊 实际签名:', signature);
    
    expect(signature).toBe(expectedSignature);
    console.log('✅ 签名验证通过！');
  });

  test('验证 User-Agent 请求头', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    if (webhookServer.events.length === 0) {
      console.log('⏭️  跳过测试：没有接收到事件');
      return;
    }

    const firstEvent = webhookServer.events[0];
    const userAgent = firstEvent.headers['user-agent'];
    
    console.log('📊 User-Agent:', userAgent);
    
    expect(userAgent).toBeDefined();
    // OneBot 实现通常会在 User-Agent 中标识自己
  });
});
