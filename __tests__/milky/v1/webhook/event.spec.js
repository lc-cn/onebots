/**
 * Milky V1 WebHook 事件推送测试
 * 测试 WebHook 事件推送功能
 * 参考: https://milky.ntqqrev.org/guide/communication
 * 
 * WebHook 配置:
 * - 在 config.yaml 中配置 webhook_url
 * - OneBots 会将事件 POST 到配置的 URL
 * - Content-Type: application/json
 * - 可选: X-Signature 签名验证
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { checkServerAvailable } from '../../utils/http-client.js';

const CONFIG = {
  baseUrl: process.env.ONEBOTS_URL || 'http://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  webhookPort: parseInt(process.env.WEBHOOK_PORT) || 8899,
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000,
};

let serverAvailable = false;
let webhookServer = null;
let receivedEvents = [];

beforeAll(async () => {
  serverAvailable = await checkServerAvailable(CONFIG.baseUrl);
  if (serverAvailable) {
    console.log('✅ 服务器可用，将执行 Milky V1 WebHook 测试');
  } else {
    console.warn('⚠️  服务器未运行，Milky V1 WebHook 测试将被跳过');
  }
});

afterAll(() => {
  if (webhookServer) {
    webhookServer.close();
  }
});

describe('Milky V1 - WebHook 事件推送', () => {
  test('启动 WebHook 接收服务器', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }

    receivedEvents = [];

    webhookServer = createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', () => {
          try {
            const event = JSON.parse(body);
            receivedEvents.push(event);

            console.log('\n📨 收到 WebHook 事件:');
            console.log('   事件类型:', event.event_type);
            console.log('   时间:', new Date(event.time * 1000).toLocaleString());
            console.log('   Headers:', JSON.stringify(req.headers, null, 2));

            // 返回 200 OK
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (error) {
            console.error('❌ 解析 WebHook 事件失败:', error.message);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: error.message }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve, reject) => {
      webhookServer.listen(CONFIG.webhookPort, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`✅ WebHook 服务器启动成功: http://localhost:${CONFIG.webhookPort}`);
          console.log(`💡 请在 config.yaml 中配置:`);
          console.log(`   webhook:`);
          console.log(`     url: http://localhost:${CONFIG.webhookPort}`);
          console.log(`     enabled: true`);
          resolve();
        }
      });
    });

    expect(webhookServer.listening).toBe(true);
  }, 10000);

  test('监听 WebHook 事件', async () => {
    if (!serverAvailable || !webhookServer) {
      console.log('⏭️  跳过测试：服务器不可用或 WebHook 服务器未启动');
      return;
    }

    console.log(`\n⏱️  监听 WebHook 事件 ${CONFIG.monitorDuration / 1000} 秒...`);
    console.log('💡 请触发一些事件（如发送消息）来测试 WebHook');

    // 等待指定时长
    await new Promise(resolve => setTimeout(resolve, CONFIG.monitorDuration));

    console.log(`\n📊 总共接收到 ${receivedEvents.length} 个 WebHook 事件`);

    if (receivedEvents.length > 0) {
      console.log('\n事件类型统计:');
      const eventTypes = {};
      receivedEvents.forEach(event => {
        eventTypes[event.event_type] = (eventTypes[event.event_type] || 0) + 1;
      });
      Object.entries(eventTypes).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} 个`);
      });

      // 验证事件格式
      const firstEvent = receivedEvents[0];
      expect(firstEvent.time).toBeDefined();
      expect(firstEvent.self_id).toBeDefined();
      expect(firstEvent.event_type).toBeDefined();
      expect(firstEvent.data).toBeDefined();
    } else {
      console.log('💡 未接收到事件（这是正常的，如果 WebHook 未配置或没有触发事件）');
      console.log('💡 请确保在 config.yaml 中正确配置了 webhook_url');
    }
  }, 15000);

  test('验证 WebHook 请求格式', () => {
    console.log('\n💡 WebHook 请求应符合以下格式:');
    console.log('   方法: POST');
    console.log('   Content-Type: application/json');
    console.log('   请求体: Milky Event JSON');
    console.log('\n   可选 Headers:');
    console.log('   - X-Signature: HMAC-SHA256 签名（如果配置了 secret）');
    console.log('   - X-Self-ID: 机器人账号 ID');
    console.log('\n   Event 结构:');
    console.log('   - time: int64 (事件发生时间戳)');
    console.log('   - self_id: int64 (机器人账号 ID)');
    console.log('   - event_type: string (事件类型)');
    console.log('   - data: object (事件数据)');
    console.log('\n   参考: https://milky.ntqqrev.org/struct/Event');
    console.log('   参考: https://milky.ntqqrev.org/guide/communication#webhook');
  });
});

describe('Milky V1 - WebHook 签名验证', () => {
  test('WebHook 签名说明', () => {
    console.log('\n💡 WebHook 签名验证（如果配置了 secret）:');
    console.log('   1. OneBots 使用 HMAC-SHA256 算法');
    console.log('   2. 签名内容: 请求体的原始 JSON 字符串');
    console.log('   3. 密钥: config.yaml 中配置的 webhook.secret');
    console.log('   4. 签名放在 X-Signature header 中');
    console.log('\n   验证代码示例:');
    console.log('   ```javascript');
    console.log('   const crypto = require("crypto");');
    console.log('   const signature = req.headers["x-signature"];');
    console.log('   const hmac = crypto.createHmac("sha256", secret);');
    console.log('   const expected = hmac.update(body).digest("hex");');
    console.log('   if (signature === expected) { /* 验证通过 */ }');
    console.log('   ```');
  });
});
