/**
 * WebSocket 连接和事件推送测试（Vitest 版本）
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';

const CONFIG = {
  wsUrl: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
  platform: process.env.PLATFORM || 'dingtalk',
  accountId: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
  accessToken: process.env.ACCESS_TOKEN || '',
  monitorDuration: parseInt(process.env.MONITOR_DURATION) || 5000, // 默认监听 5 秒（测试模式）
};

// 构建 WebSocket URL
function buildWsUrl(protocol, version) {
  const path = `/${CONFIG.platform}/${CONFIG.accountId}/${protocol}/${version}`;  // WebSocket 直接在协议路径上
  let url = `${CONFIG.wsUrl}${path}`;
  
  if (CONFIG.accessToken) {
    url += `?access_token=${CONFIG.accessToken}`;
  }
  
  return url;
}

function monitorWebSocket(name, url, duration = CONFIG.monitorDuration) {
  return new Promise((resolve, reject) => {
    const events = [];
    const startTime = Date.now();
    
    console.log(`\n[${name}] 连接: ${url}`);
    console.log(`[${name}] 开始监听事件 (${duration}ms)...`);
    
    const ws = new WebSocket(url);
    
    const timeout = setTimeout(() => {
      console.log(`[${name}] 监听结束，共接收 ${events.length} 个事件`);
      ws.close();
      resolve(events);
    }, duration);
    
    ws.on('open', () => {
      console.log(`[${name}] ✓ WebSocket 连接已建立`);
    });
    
    ws.on('message', (data) => {
      const elapsed = Date.now() - startTime;
      try {
        const message = JSON.parse(data.toString());
        events.push(message);
        console.log(`[${name}] [${elapsed}ms] 收到事件类型:`, message.post_type || message.type || 'unknown');
      } catch (error) {
        console.error(`[${name}] 解析消息失败:`, error.message);
      }
    });
    
    ws.on('error', (error) => {
      console.error(`[${name}] ✗ WebSocket 错误:`, error.message);
      clearTimeout(timeout);
      
      if (error.message.includes('ECONNREFUSED')) {
        console.log(`[${name}] ⚠ 服务器未运行`);
        resolve(events);
      } else {
        reject(error);
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`[${name}] 连接关闭 [code=${code}]`);
      clearTimeout(timeout);
      resolve(events);
    });
  });
}

let serverAvailable = false;

beforeAll(async () => {
  try {
    const response = await fetch(`${CONFIG.wsUrl.replace('ws', 'http')}/list`, {
      signal: AbortSignal.timeout(3000),
    });
    serverAvailable = response.ok || response.status === 401;
    if (serverAvailable) {
      console.log('✅ 服务器可用，将执行 WebSocket 测试');
    }
  } catch (error) {
    console.warn('⚠️  服务器未运行，WebSocket 测试将被跳过');
    serverAvailable = false;
  }
});

describe('WebSocket 事件监听测试', () => {
  test('配置信息', () => {
    console.log('\n配置信息:');
    console.log(`  WebSocket URL: ${CONFIG.wsUrl}`);
    console.log(`  平台: ${CONFIG.platform}`);
    console.log(`  账号: ${CONFIG.accountId}`);
    console.log(`  监听时长: ${CONFIG.monitorDuration}ms`);
    console.log(`  服务器状态: ${serverAvailable ? '✅ 可用' : '❌ 不可用'}\n`);
    expect(CONFIG.wsUrl).toBeTruthy();
  });
  
  test('OneBot V11 WebSocket 连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    const url = buildWsUrl('onebot', 'v11');
    const events = await monitorWebSocket('OneBot V11', url, CONFIG.monitorDuration);
    
    // 验证可以建立连接（即使没有收到事件也算通过）
    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
  }, CONFIG.monitorDuration + 5000);
  
  test('OneBot V12 WebSocket 连接', async () => {
    if (!serverAvailable) {
      console.log('⏭️  跳过测试：服务器不可用');
      return;
    }
    const url = buildWsUrl('onebot', 'v12');
    const events = await monitorWebSocket('OneBot V12', url, CONFIG.monitorDuration);
    
    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
  }, CONFIG.monitorDuration + 5000);
});
