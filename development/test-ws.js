#!/usr/bin/env node
/**
 * WebSocket 正向连接测试脚本
 * 用于测试 OneBot V11/V12 和 Milky 协议的 WebSocket 连接可行性
 * 
 * 使用方法:
 *   node test-ws.js [platform] [account_id] [protocol] [version]
 * 
 * 示例:
 *   node test-ws.js kook zhin onebot v11
 *   node test-ws.js kook zhin onebot v12
 *   node test-ws.js kook zhin milky v1
 */

import { WebSocket } from 'ws';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const configPath = path.join(__dirname, 'config.yaml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

const PORT = config.port || 6727;
const BASE_URL = `ws://localhost:${PORT}`;

// 从命令行参数或配置中获取参数
const args = process.argv.slice(2);
const platform = args[0] || 'kook';
const accountId = args[1] || 'zhin';
const protocol = args[2] || 'onebot';
const version = args[3] || 'v11';

// 获取 access_token
function getAccessToken(platform, accountId, protocol, version) {
    const accountKey = `${platform}.${accountId}`;
    const accountConfig = config[accountKey];
    
    if (accountConfig && accountConfig[`${protocol}.${version}`]) {
        return accountConfig[`${protocol}.${version}`].access_token || '';
    }
    
    // 尝试从 general 配置获取
    if (config.general && config.general[`${protocol}.${version}`]) {
        return config.general[`${protocol}.${version}`].access_token || '';
    }
    
    return '';
}

// 构建 WebSocket URL
function buildWsUrl(platform, accountId, protocol, version) {
    let path = `/${platform}/${accountId}/${protocol}/${version}`;
    
    // Milky 协议的 WebSocket 路径是 /event
    if (protocol === 'milky' && version === 'v1') {
        path += '/event';
    }
    
    const token = getAccessToken(platform, accountId, protocol, version);
    const url = `${BASE_URL}${path}${token ? `?access_token=${token}` : ''}`;
    
    return url;
}

// 测试 WebSocket 连接
async function testWebSocket(url, protocol, version) {
    return new Promise((resolve, reject) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`测试 ${protocol.toUpperCase()} ${version.toUpperCase()} WebSocket 连接`);
        console.log(`${'='.repeat(60)}`);
        console.log(`连接地址: ${url}`);
        console.log(`开始时间: ${new Date().toLocaleString()}\n`);

        const results = {
            connected: false,
            receivedEvents: [],
            apiTests: [],
            errors: [],
            startTime: Date.now(),
            endTime: null,
        };

        const ws = new WebSocket(url);
        let testTimeout;
        let heartbeatInterval;

        // 连接超时
        const connectTimeout = setTimeout(() => {
            if (!results.connected) {
                console.log('❌ 连接超时（5秒）');
                ws.close();
                reject(new Error('Connection timeout'));
            }
        }, 5000);

        ws.on('open', () => {
            clearTimeout(connectTimeout);
            results.connected = true;
            console.log('✅ WebSocket 连接成功\n');

            // 测试 API 调用
            setTimeout(() => {
                testApiCalls(ws, protocol, version, results);
            }, 1000);

            // 设置测试超时（30秒后结束）
            testTimeout = setTimeout(() => {
                console.log('\n⏱️  测试时间到（30秒），关闭连接...');
                ws.close();
            }, 30000);
        });

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                const elapsed = Date.now() - results.startTime;

                // 记录事件
                results.receivedEvents.push({
                    elapsed,
                    message,
                });

                // 打印事件信息
                const eventType = message.post_type || message.type || message.meta_event_type || 'unknown';
                console.log(`[${elapsed}ms] 📨 收到事件: ${eventType}`);

                // 打印详细信息
                if (message.post_type === 'meta_event') {
                    console.log(`    └─ 类型: ${message.meta_event_type || 'unknown'}`);
                    if (message.sub_type) {
                        console.log(`    └─ 子类型: ${message.sub_type}`);
                    }
                } else if (message.post_type === 'message') {
                    console.log(`    └─ 消息类型: ${message.message_type || 'unknown'}`);
                    console.log(`    └─ 发送者: ${message.sender?.user_id || message.user_id || 'unknown'}`);
                    const content = typeof message.message === 'string' 
                        ? message.message 
                        : JSON.stringify(message.message);
                    const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
                    console.log(`    └─ 内容: ${preview}`);
                } else if (message.type) {
                    console.log(`    └─ 类型: ${message.type}`);
                }

                // 检查是否是 API 响应
                if (message.echo !== undefined || message.status !== undefined) {
                    const apiTest = results.apiTests.find(t => t.echo === message.echo);
                    if (apiTest) {
                        apiTest.response = message;
                        apiTest.responseTime = elapsed - apiTest.requestTime;
                        console.log(`    └─ ✅ API 响应 (${apiTest.responseTime}ms)`);
                        if (message.status === 'ok' || message.retcode === 0) {
                            apiTest.success = true;
                        }
                    }
                }

            } catch (error) {
                console.error(`❌ 解析消息失败:`, error.message);
                results.errors.push({
                    type: 'parse_error',
                    error: error.message,
                    data: data.toString(),
                });
            }
        });

        ws.on('error', (error) => {
            clearTimeout(connectTimeout);
            clearTimeout(testTimeout);
            if (heartbeatInterval) clearInterval(heartbeatInterval);

            console.error(`\n❌ WebSocket 错误:`, error.message);
            results.errors.push({
                type: 'connection_error',
                error: error.message,
            });

            if (error.message.includes('ECONNREFUSED')) {
                console.log('\n⚠️  无法连接到服务器，请确保 onebots 服务正在运行');
                console.log(`   启动命令: cd development && pnpm dev\n`);
            }

            reject(error);
        });

        ws.on('close', (code, reason) => {
            clearTimeout(connectTimeout);
            clearTimeout(testTimeout);
            if (heartbeatInterval) clearInterval(heartbeatInterval);

            results.endTime = Date.now();
            const duration = results.endTime - results.startTime;

            console.log(`\n${'='.repeat(60)}`);
            console.log('测试结果汇总');
            console.log(`${'='.repeat(60)}`);
            console.log(`连接状态: ${results.connected ? '✅ 成功' : '❌ 失败'}`);
            console.log(`持续时间: ${(duration / 1000).toFixed(2)} 秒`);
            console.log(`收到事件数: ${results.receivedEvents.length}`);
            console.log(`API 测试数: ${results.apiTests.length}`);
            console.log(`API 成功数: ${results.apiTests.filter(t => t.success).length}`);
            console.log(`错误数: ${results.errors.length}`);

            if (results.receivedEvents.length > 0) {
                console.log(`\n收到的事件类型:`);
                const eventTypes = {};
                results.receivedEvents.forEach(e => {
                    const type = e.message.post_type || e.message.type || 'unknown';
                    eventTypes[type] = (eventTypes[type] || 0) + 1;
                });
                Object.entries(eventTypes).forEach(([type, count]) => {
                    console.log(`  - ${type}: ${count}`);
                });
            }

            if (results.errors.length > 0) {
                console.log(`\n错误列表:`);
                results.errors.forEach((err, i) => {
                    console.log(`  ${i + 1}. [${err.type}] ${err.error}`);
                });
            }

            console.log(`${'='.repeat(60)}\n`);

            resolve(results);
        });
    });
}

// 测试 API 调用
function testApiCalls(ws, protocol, version, results) {
    console.log('📤 开始 API 测试...\n');

    // 根据协议选择不同的 API
    const apis = [];

    if (protocol === 'onebot' && version === 'v11') {
        apis.push(
            { action: 'get_login_info', params: {}, description: '获取登录信息' },
            { action: 'get_version_info', params: {}, description: '获取版本信息' },
            { action: 'get_status', params: {}, description: '获取运行状态' },
        );
    } else if (protocol === 'onebot' && version === 'v12') {
        apis.push(
            { action: 'get_self_info', params: {}, description: '获取自身信息' },
            { action: 'get_version', params: {}, description: '获取版本信息' },
            { action: 'get_status', params: {}, description: '获取运行状态' },
        );
    } else if (protocol === 'milky' && version === 'v1') {
        apis.push(
            { action: 'get_login_info', params: {}, description: '获取登录信息' },
            { action: 'get_version_info', params: {}, description: '获取版本信息' },
            { action: 'get_status', params: {}, description: '获取运行状态' },
        );
    }

    apis.forEach((api, index) => {
        setTimeout(() => {
            const echo = `test_${Date.now()}_${index}`;
            const request = {
                action: api.action,
                params: api.params,
                echo: echo,
            };

            results.apiTests.push({
                echo,
                action: api.action,
                requestTime: Date.now(),
                success: false,
            });

            console.log(`📤 [${index + 1}/${apis.length}] ${api.description} (${api.action})`);
            ws.send(JSON.stringify(request));
        }, index * 500); // 每个 API 间隔 500ms
    });
}

// 主函数
async function main() {
    try {
        const url = buildWsUrl(platform, accountId, protocol, version);
        await testWebSocket(url, protocol, version);
    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        process.exit(1);
    }
}

// 运行测试
main().catch(error => {
    console.error('未处理的错误:', error);
    process.exit(1);
});

