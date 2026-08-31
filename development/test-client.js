#!/usr/bin/env node

/**
 * 客户端SDK开发测试脚本
 * 用于测试和开发客户端SDK功能
 */

import { createImHelper } from 'imhelper';
import { createOnebot11Adapter } from '@imhelper/onebot-v11';
import { createOnebot12Adapter } from '@imhelper/onebot-v12';
import fs from 'fs';
import yaml from 'js-yaml';

// 从环境变量或命令行参数获取配置
const platform = process.env.PLATFORM || 'discord';
const accountId = process.env.ACCOUNT_ID || 'zhin';
const protocol = process.env.PROTOCOL || 'onebot';
const version = process.env.VERSION || 'v11';
const receiveMode = process.env.RECEIVE_MODE || 'ws';
const baseUrl = process.env.BASE_URL || 'http://localhost:6727';

// 尝试从配置文件读取 access_token
let accessToken = process.env.ACCESS_TOKEN || '';
if (!accessToken) {
  try {
    const configPath = process.env.CONFIG_PATH || 'config.yaml';
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(configContent);
      const accountKey = `${platform}.${accountId}`;
      const protocolKey = `${protocol}.${version}`;
      
      if (config[accountKey] && config[accountKey][protocolKey]) {
        accessToken = config[accountKey][protocolKey].access_token || '';
      } else if (config.general && config.general[protocolKey]) {
        accessToken = config.general[protocolKey].access_token || '';
      }
    }
  } catch (error) {
    console.warn('⚠️  无法读取配置文件，使用空 access_token:', error.message);
  }
}

console.log('🚀 启动客户端SDK开发测试');
console.log('配置:', {
  platform,
  accountId,
  protocol,
  version,
  receiveMode,
  baseUrl,
  accessToken: accessToken ? `${accessToken.substring(0, 4)}...` : '(empty)',
});

async function main() {
  try {
    let adapter;
    
    // 根据协议版本创建适配器
    // 服务器端路径格式: /{platform}/{account_id}/onebot/v11
    if (protocol === 'onebot' && version === 'v11') {
      const wsPath = `/${platform}/${accountId}/onebot/v11`;
      adapter = createOnebot11Adapter({
        baseUrl,
        selfId: accountId,
        accessToken,
        receiveMode: receiveMode, // 'ws' | 'wss' | 'webhook' | 'sse'
        path: wsPath,
        wsUrl: baseUrl.replace(/^http/, 'ws') + wsPath,
        platform, // 传递 platform 参数
      });
    } else if (protocol === 'onebot' && version === 'v12') {
      const wsPath = `/${platform}/${accountId}/onebot/v12`;
      adapter = createOnebot12Adapter({
        baseUrl,
        selfId: accountId,
        accessToken,
        receiveMode: receiveMode,
        wsUrl: baseUrl.replace(/^http/, 'ws') + wsPath,
        platform, // 传递 platform 参数
      });
    } else {
      console.error(`❌ 不支持的协议: ${protocol}/${version}`);
      console.log('支持的协议: onebot/v11, onebot/v12');
      process.exit(1);
    }

    // 创建统一的消息助手
    const imHelper = createImHelper(adapter);

    // 监听事件
    imHelper.on('message.private', (message) => {
      console.log('📩 收到私信:', {
        id: message.id,
        sender: message.sender.id,
        content: message.content,
      });
      // 自动回复
      message.reply('Hello from client SDK!').catch(console.error);
    });

    imHelper.on('message.group', (message) => {
      console.log('👥 收到群消息:', {
        id: message.id,
        sender: message.sender.id,
        scene_id: message.scene_id,
        content: message.content,
      });
      // 自动回复
      message.reply('Hello from client SDK!').catch(console.error);
    });

    imHelper.on('message.channel', (message) => {
      console.log('📢 收到频道消息:', {
        id: message.id,
        sender: message.sender.id,
        scene_id: message.scene_id,
        content: message.content,
      });
      // 自动回复
      message.reply('Hello from client SDK!').catch(console.error);
    });

    // 监听所有事件
    imHelper.on('event', (event) => {
      console.log('📡 收到事件:', event.type || event.post_type || 'unknown');
    });

    // 启动服务
    const port = receiveMode === 'webhook' || receiveMode === 'wss' ? 8080 : undefined;
    await imHelper.start(port);
    
    console.log('✅ 客户端SDK已启动');
    if (port) {
      console.log(`📡 监听端口: ${port}`);
    }
    if (receiveMode === 'ws' || receiveMode === 'wss') {
      const wsPath = protocol === 'onebot' && version === 'v11' 
        ? `/${platform}/${accountId}/onebot/v11`
        : `/${platform}/${accountId}/onebot/v12`;
      const wsProtocol = receiveMode === 'wss' ? 'wss' : 'ws';
      console.log(`🔗 WebSocket 连接: ${baseUrl.replace(/^http/, wsProtocol)}${wsPath}`);
    }
    console.log('等待消息...\n');

    // 优雅退出
    process.on('SIGINT', async () => {
      console.log('\n🛑 收到 SIGINT，正在关闭...');
      await imHelper.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 收到 SIGTERM，正在关闭...');
      await imHelper.stop();
      process.exit(0);
    });

    // 处理进程退出（node --watch 会发送这个信号）
    let isExiting = false;
    const cleanup = async () => {
      if (isExiting) return;
      isExiting = true;
      console.log('\n🛑 正在关闭连接...');
      try {
        await imHelper.stop();
      } catch (error) {
        console.error('关闭连接时出错:', error);
      }
    };

    process.on('beforeExit', cleanup);
    process.on('exit', () => {
      // exit 事件中不能使用异步操作，但可以确保同步清理
      console.log('进程退出');
    });

  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

main();

