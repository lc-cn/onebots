/**
 * 黑盒语音联调脚本
 * 需要环境变量 HEYCHAT_TOKEN
 *
 * 用法: HEYCHAT_TOKEN=xxx node development/test-heychat.js
 */
import { HeychatBot } from '../adapters/adapter-heychat/lib/bot.js';

const token = process.env.HEYCHAT_TOKEN;
if (!token) {
    console.log('⏭️ 跳过：未设置 HEYCHAT_TOKEN 环境变量');
    process.exit(0);
}

const bot = new HeychatBot({
    account_id: 'test',
    token,
    chat_version: process.env.HEYCHAT_CHAT_VERSION || '1.30.0',
});

let connected = false;

bot.on('ready', () => {
    connected = true;
    console.log('✅ WebSocket 已连接');
});

bot.on('message', (event) => {
    console.log(`📩 收到${event.source === 'command' ? '命令' : '消息'}:`, event.raw_message);
    console.log(`   room=${event.room_id} channel=${event.channel_id}`);
});

bot.on('error', (error) => {
    console.error('❌ 错误:', error);
});

bot.on('raw_event', ({ type, data }) => {
    console.log(`ℹ️ 未处理事件 type=${type}`, JSON.stringify(data).slice(0, 200));
});

console.log('正在连接黑盒语音 WebSocket...');
await bot.start();

setTimeout(async () => {
    if (connected) {
        console.log('✅ 联调完成：WebSocket 连接正常');
    } else {
        console.log('❌ 联调失败：未能建立连接');
    }
    await bot.stop();
    process.exit(connected ? 0 : 1);
}, 10000);
