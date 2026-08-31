/**
 * Mock 适配器单元测试
 * 这些测试不需要真实服务器，适合在 CI/CD 中运行
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// 动态导入以支持构建后的测试
let MockBot;
let MockAdapter;

describe('Mock 适配器 - 单元测试', () => {
    let bot;

    beforeAll(async () => {
        // 尝试从构建后的 lib 导入，如果失败则跳过
        try {
            const module = await import('../../adapters/adapter-mock/lib/index.js');
            MockBot = module.MockBot;
            MockAdapter = module.MockAdapter;
        } catch (error) {
            console.log('⚠️  Mock 适配器未构建，跳过单元测试');
            console.log('   运行 "pnpm build" 构建后再测试');
        }
    });

    beforeEach(async () => {
        if (!MockBot) return;
        
        bot = new MockBot({
            account_id: 'test_bot_123',
            nickname: 'Test Bot',
            avatar: 'https://example.com/avatar.png',
            latency: 0, // 测试时禁用延迟
            auto_events: false,
        });
        await bot.start();
    });

    afterAll(async () => {
        if (bot?.isActive()) {
            await bot.stop();
        }
    });

    describe('基础功能', () => {
        test('启动和停止', async () => {
            if (!MockBot) return;
            
            expect(bot.isActive()).toBe(true);
            await bot.stop();
            expect(bot.isActive()).toBe(false);
        });

        test('getLoginInfo - 获取登录信息', async () => {
            if (!MockBot) return;
            
            const info = await bot.getLoginInfo();
            
            expect(info).toBeDefined();
            expect(info.user_id).toBe('test_bot_123');
            expect(info.nickname).toBe('Test Bot');
        });
    });

    describe('好友相关', () => {
        test('getFriendList - 获取好友列表', async () => {
            if (!MockBot) return;
            
            const friends = await bot.getFriendList();
            
            expect(Array.isArray(friends)).toBe(true);
            expect(friends.length).toBeGreaterThan(0);
            
            // 验证好友结构
            const friend = friends[0];
            expect(friend).toHaveProperty('user_id');
            expect(friend).toHaveProperty('nickname');
        });

        test('getUserInfo - 获取用户信息', async () => {
            if (!MockBot) return;
            
            // 默认好友 ID 是 10001
            const user = await bot.getUserInfo('10001');
            
            expect(user).toBeDefined();
            expect(user.user_id).toBe('10001');
            expect(user.nickname).toBeDefined();
        });

        test('addFriend - 添加模拟好友', async () => {
            if (!MockBot) return;
            
            const newFriend = {
                user_id: '99999',
                nickname: '新好友',
                avatar: 'https://example.com/new.png',
            };
            
            bot.addFriend(newFriend);
            
            const user = await bot.getUserInfo('99999');
            expect(user).toBeDefined();
            expect(user.nickname).toBe('新好友');
        });
    });

    describe('群组相关', () => {
        test('getGroupList - 获取群组列表', async () => {
            if (!MockBot) return;
            
            const groups = await bot.getGroupList();
            
            expect(Array.isArray(groups)).toBe(true);
            expect(groups.length).toBeGreaterThan(0);
            
            // 验证群组结构
            const group = groups[0];
            expect(group).toHaveProperty('group_id');
            expect(group).toHaveProperty('group_name');
        });

        test('getGroupInfo - 获取群组信息', async () => {
            if (!MockBot) return;
            
            // 默认群组 ID 是 100001
            const group = await bot.getGroupInfo('100001');
            
            expect(group).toBeDefined();
            expect(group.group_id).toBe('100001');
            expect(group.group_name).toBe('测试群1');
        });

        test('getGroupMemberList - 获取群成员列表', async () => {
            if (!MockBot) return;
            
            const members = await bot.getGroupMemberList('100001');
            
            expect(Array.isArray(members)).toBe(true);
            expect(members.length).toBeGreaterThan(0);
            
            // 验证成员结构
            const member = members[0];
            expect(member).toHaveProperty('user_id');
            expect(member).toHaveProperty('nickname');
            expect(member).toHaveProperty('role');
        });

        test('addGroup - 添加模拟群组', async () => {
            if (!MockBot) return;
            
            const newGroup = {
                group_id: '888888',
                group_name: '新测试群',
                member_count: 10,
                members: [
                    { user_id: '10001', nickname: '成员1', role: 'owner' },
                ],
            };
            
            bot.addGroup(newGroup);
            
            const group = await bot.getGroupInfo('888888');
            expect(group).toBeDefined();
            expect(group.group_name).toBe('新测试群');
        });
    });

    describe('消息相关', () => {
        test('sendMessage - 发送私聊消息', async () => {
            if (!MockBot) return;
            
            const result = await bot.sendMessage('10001', 'Hello!', 'private');
            
            expect(result).toBeDefined();
            expect(result.message_id).toBeDefined();
            expect(result.message_id).toContain('mock_msg_');
        });

        test('sendMessage - 发送群消息', async () => {
            if (!MockBot) return;
            
            const result = await bot.sendMessage('100001', 'Hello Group!', 'group');
            
            expect(result).toBeDefined();
            expect(result.message_id).toBeDefined();
        });

        test('getMessage - 获取消息', async () => {
            if (!MockBot) return;
            
            // 先发送一条消息
            const { message_id } = await bot.sendMessage('10001', 'Test Message');
            
            // 获取消息
            const message = await bot.getMessage(message_id);
            
            expect(message).toBeDefined();
            expect(message.content).toBe('Test Message');
        });

        test('deleteMessage - 删除消息', async () => {
            if (!MockBot) return;
            
            // 先发送一条消息
            const { message_id } = await bot.sendMessage('10001', 'To Delete');
            
            // 删除消息
            const deleted = await bot.deleteMessage(message_id);
            expect(deleted).toBe(true);
            
            // 确认消息已删除
            const message = await bot.getMessage(message_id);
            expect(message).toBeNull();
        });

        test('getSentMessages - 获取所有已发送消息', async () => {
            if (!MockBot) return;
            
            bot.clearData(); // 清除之前的数据
            
            await bot.sendMessage('10001', 'Message 1');
            await bot.sendMessage('10001', 'Message 2');
            await bot.sendMessage('100001', 'Message 3', 'group');
            
            const messages = bot.getSentMessages();
            expect(messages.length).toBe(3);
        });
    });

    describe('事件触发', () => {
        test('triggerEvent - 手动触发私聊消息事件', async () => {
            if (!MockBot) return;
            
            const events = [];
            bot.on('message', (e) => events.push(e));
            
            bot.triggerEvent('message', {
                type: 'private',
                message_id: 'test_msg_1',
                user_id: '10001',
                nickname: '测试好友',
                content: '测试消息内容',
                time: Math.floor(Date.now() / 1000),
            });
            
            expect(events.length).toBe(1);
            expect(events[0].type).toBe('private');
            expect(events[0].content).toBe('测试消息内容');
        });

        test('triggerEvent - 手动触发群消息事件', async () => {
            if (!MockBot) return;
            
            const events = [];
            bot.on('message', (e) => events.push(e));
            
            bot.triggerEvent('message', {
                type: 'group',
                message_id: 'test_msg_2',
                group_id: '100001',
                group_name: '测试群',
                user_id: '10001',
                nickname: '群成员',
                content: '群消息内容',
                time: Math.floor(Date.now() / 1000),
            });
            
            expect(events.length).toBe(1);
            expect(events[0].type).toBe('group');
            expect(events[0].group_id).toBe('100001');
        });

        test('triggerEvent - 手动触发好友请求事件', async () => {
            if (!MockBot) return;
            
            const events = [];
            bot.on('request', (e) => events.push(e));
            
            bot.triggerEvent('request', {
                type: 'friend',
                user_id: '12345',
                nickname: '新好友',
                comment: '请求添加好友',
                flag: 'flag_123',
            });
            
            expect(events.length).toBe(1);
            expect(events[0].type).toBe('friend');
            expect(events[0].comment).toBe('请求添加好友');
        });
    });

    describe('数据管理', () => {
        test('clearData - 清除所有数据', async () => {
            if (!MockBot) return;
            
            // 添加一些数据
            bot.addFriend({ user_id: '77777', nickname: '临时好友' });
            await bot.sendMessage('10001', 'Temp Message');
            
            // 清除数据
            bot.clearData();
            
            // 验证数据已重置为默认值
            const user = await bot.getUserInfo('77777');
            expect(user).toBeNull();
            
            // 默认好友应该还在
            const defaultFriend = await bot.getUserInfo('10001');
            expect(defaultFriend).toBeDefined();
        });
    });
});

describe('Mock 适配器 - 错误处理', () => {
    let bot;

    beforeAll(async () => {
        if (!MockBot) {
            try {
                const module = await import('../../adapters/adapter-mock/lib/index.js');
                MockBot = module.MockBot;
            } catch (error) {
                // Skip if not built
            }
        }
    });

    beforeEach(async () => {
        if (!MockBot) return;
        
        bot = new MockBot({
            account_id: 'error_test_bot',
            latency: 0,
        });
        await bot.start();
    });

    afterAll(async () => {
        if (bot?.isActive()) {
            await bot.stop();
        }
    });

    test('getUserInfo - 不存在的用户返回 null', async () => {
        if (!MockBot) return;
        
        const user = await bot.getUserInfo('non_existent_user');
        expect(user).toBeNull();
    });

    test('getGroupInfo - 不存在的群组返回 null', async () => {
        if (!MockBot) return;
        
        const group = await bot.getGroupInfo('non_existent_group');
        expect(group).toBeNull();
    });

    test('getGroupMemberList - 不存在的群组返回空数组', async () => {
        if (!MockBot) return;
        
        const members = await bot.getGroupMemberList('non_existent_group');
        expect(members).toEqual([]);
    });

    test('getMessage - 不存在的消息返回 null', async () => {
        if (!MockBot) return;
        
        const message = await bot.getMessage('non_existent_message');
        expect(message).toBeNull();
    });

    test('deleteMessage - 删除不存在的消息返回 false', async () => {
        if (!MockBot) return;
        
        const result = await bot.deleteMessage('non_existent_message');
        expect(result).toBe(false);
    });
});

