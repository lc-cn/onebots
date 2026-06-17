/**
 * MockAdapter 单元测试
 *
 * 覆盖场景：
 * 1. 生命周期：createAccount → start → getLoginInfo → stop
 * 2. 消息发送：文本/混合 segment，private/group 场景
 * 3. ID 管理：createId / resolveId 往返、缓存、异常输入
 * 4. 群组操作：getGroupList、getGroupInfo、不存在的群
 * 5. 用户操作：getFriendList、getUserInfo、不存在的用户
 * 6. 状态转换：Pending → Online → Offline
 * 7. 删除消息
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock node:sqlite before any imports that depend on it.
// The real SqliteDB constructor uses DatabaseSync internally; we replace it
// so vitest can resolve the built-in module without a real node:sqlite binding.
vi.mock('node:sqlite', () => {
    const mockAll = vi.fn(() => []);
    const mockRun = vi.fn();
    const mockPrepare = vi.fn(() => ({ all: mockAll, run: mockRun }));
    return {
        DatabaseSync: class MockDatabaseSync {
            exec = vi.fn();
            prepare = mockPrepare;
            close = vi.fn();
        },
    };
});

import { MockAdapter } from '../adapter.js';
import { AccountStatus } from 'onebots';

// ============================================================
// 内存 Mock SqliteDB —— 满足 Adapter 基类对 db 的全部要求：
//   - db.create(tableName, schema)
//   - db.select('*').from(t).where(c).run()
//   - db.insert(t).values(row).run()
// 不依赖 node:sqlite / DatabaseSync，可以安全在任何 Node 版本运行。
// ============================================================
class MockSqliteDB {
    private tables = new Map<string, Array<Record<string, any>>>();

    create(tableName: string, _schema: unknown): void {
        if (!this.tables.has(tableName)) {
            this.tables.set(tableName, []);
        }
    }

    /* eslint-disable @typescript-eslint/no-this-alias */
    select(...fields: string[]) {
        const self = this;
        let tableName = '';
        return {
            from(t: string) {
                tableName = t;
                return {
                    where: (condition: Record<string, any>) => ({
                        run: (): any[] => {
                            const rows = self.rows(tableName);
                            const matched = rows.filter((r) =>
                                Object.entries(condition).every(([k, v]) => r[k] === v),
                            );
                            if (fields.length === 1 && fields[0] === '*') return matched;
                            return matched.map((r) => {
                                const obj: Record<string, any> = {};
                                for (const f of fields) obj[f] = r[f];
                                return obj;
                            });
                        },
                    }),
                };
            },
        };
    }

    insert(table: string) {
        const self = this;
        return {
            values: (first: any, ...rest: any[]) => ({
                run: () => {
                    const rows = self.rows(table);
                    for (const row of [first, ...rest]) {
                        rows.push(row);
                    }
                },
            }),
        };
    }

    private rows(name: string): Array<Record<string, any>> {
        if (!this.tables.has(name)) this.tables.set(name, []);
        return this.tables.get(name)!;
    }
}

// ============================================================
// 最小化 Mock App —— 仅暴露 Adapter 基类依赖的成员
// ============================================================
function createMockApp() {
    return {
        db: new MockSqliteDB(),
        config: { general: {}, log_level: 'off' as const },
        getLogger: () => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
            level: 'off' as const,
        }),
    };
}

// ============================================================
// 辅助：快速启动一个账号并等待 ready 事件
// ============================================================
async function createAndStartAccount(
    adapter: MockAdapter,
    overrides: Record<string, any> = {},
) {
    const config = {
        platform: 'mock' as const,
        account_id: overrides.account_id || (overrides.nickname || 'Test') + '_bot',
        nickname: overrides.nickname || 'Tester',
        latency: 0,
        friends: overrides.friends,
        groups: overrides.groups,
    };
    const account = adapter.createAccount(config);
    adapter.accounts.set(config.account_id, account);

    // Listen for the bot's 'ready' event before starting, so we can wait
    // for the async start handler to complete
    const ready = new Promise<void>((resolve) => {
        account.client.once('ready', () => resolve());
    });

    await adapter.start(config.account_id);
    await ready;
    return { account, config };
}

describe('MockAdapter', () => {
    let adapter: MockAdapter;
    let mockApp: ReturnType<typeof createMockApp>;

    beforeEach(() => {
        mockApp = createMockApp();
        adapter = new MockAdapter(mockApp as any);
    });

    afterEach(() => {
        adapter.removeAllListeners();
    });

    // ==========================================================
    // 1. 生命周期
    // ==========================================================
    describe('lifecycle', () => {
        it('should transition Pending → Online on start → Offline on stop', async () => {
            const { account } = await createAndStartAccount(adapter, { account_id: 'lifecycle_bot' });

            // Pending → Online after ready
            expect(account.status).toBe(AccountStatus.Online);
            expect(account.nickname).toBe('Tester');

            // Stop
            await adapter.stop('lifecycle_bot');
            expect(account.status).toBe(AccountStatus.OffLine);
        });

        it('should start only the specified account', async () => {
            const a1 = adapter.createAccount({
                platform: 'mock', account_id: 'bot1', nickname: 'Bot1', latency: 0,
            } as any);
            const a2 = adapter.createAccount({
                platform: 'mock', account_id: 'bot2', nickname: 'Bot2', latency: 100,
            } as any);
            adapter.accounts.set('bot1', a1);
            adapter.accounts.set('bot2', a2);

            const ready1 = new Promise<void>((r) => a1.client.once('ready', () => r()));

            await adapter.start('bot1');
            await ready1;

            expect(a1.status).toBe(AccountStatus.Online);
            expect(a2.status).toBe(AccountStatus.Pending);
        });

        it('should throw for non-existent account access', async () => {
            await expect(adapter.getLoginInfo('ghost')).rejects.toThrow('Account ghost not found');
            await expect(adapter.getFriendList('ghost')).rejects.toThrow('Account ghost not found');
            await expect(adapter.getGroupList('ghost')).rejects.toThrow('Account ghost not found');
            await expect(
                adapter.sendMessage('ghost', null as any),
            ).rejects.toThrow('Account ghost not found');
        });
    });

    // ==========================================================
    // 2. 消息发送
    // ==========================================================
    describe('message sending', () => {
        beforeEach(async () => {
            await createAndStartAccount(adapter, { account_id: 'msg_bot' });
        });

        it('should send a text message to private user', async () => {
            const result = await adapter.sendMessage('msg_bot', {
                scene_type: 'private',
                scene_id: adapter.createId('10001'),
                message: [{ type: 'text', data: { text: 'Hello, world!' } }],
            });

            expect(result.message_id.string).toBeTruthy();
            expect(result.message_id.number).toEqual(expect.any(Number));
        });

        it('should send a text message to group', async () => {
            const result = await adapter.sendMessage('msg_bot', {
                scene_type: 'group',
                scene_id: adapter.createId('100001'),
                message: [{ type: 'text', data: { text: 'Group hello' } }],
            });

            expect(result.message_id).toBeDefined();
        });

        it('should handle non-text segments (image, face, etc.)', async () => {
            const result = await adapter.sendMessage('msg_bot', {
                scene_type: 'group',
                scene_id: adapter.createId('100001'),
                message: [
                    { type: 'text', data: { text: 'Check: ' } },
                    { type: 'image', data: { file: 'https://example.com/pic.png' } },
                    { type: 'face', data: { id: '14' } },
                    { type: 'at', data: { qq: '10001' } },
                ],
            });

            // Non-text segments get serialised to `[image]` etc. by buildMessageContent
            expect(result.message_id.string).toBeTruthy();
        });

        it('should return unique message IDs on successive sends', async () => {
            const r1 = await adapter.sendMessage('msg_bot', {
                scene_type: 'private', scene_id: adapter.createId('10001'),
                message: [{ type: 'text', data: { text: 'msg1' } }],
            });
            const r2 = await adapter.sendMessage('msg_bot', {
                scene_type: 'private', scene_id: adapter.createId('10001'),
                message: [{ type: 'text', data: { text: 'msg2' } }],
            });

            expect(r1.message_id.string).not.toBe(r2.message_id.string);
        });

        it('should throw when account does not exist', async () => {
            await expect(
                adapter.sendMessage('ghost', {
                    scene_type: 'private',
                    scene_id: adapter.createId('10001'),
                    message: [{ type: 'text', data: { text: 'hi' } }],
                }),
            ).rejects.toThrow('Account ghost not found');
        });
    });

    // ==========================================================
    // 3. ID 管理
    // ==========================================================
    describe('ID management', () => {
        it('should round-trip createId → resolveId for a string id', () => {
            const original = 'user_abc_123';
            const created = adapter.createId(original);

            expect(created.string).toBe(original);
            expect(created.number).toEqual(expect.any(Number));
            expect(created.source).toBe(original);

            // Resolve by string → same mapping
            const byString = adapter.resolveId(original);
            expect(byString.string).toBe(original);
            expect(byString.number).toBe(created.number);

            // Resolve by number → same mapping
            const byNumber = adapter.resolveId(created.number);
            expect(byNumber.string).toBe(original);
            expect(byNumber.number).toBe(created.number);
        });

        it('should return cached Id when the same string is created twice', () => {
            const first = adapter.createId('duplicate');
            const second = adapter.createId('duplicate');

            expect(second.string).toBe(first.string);
            expect(second.number).toBe(first.number);
        });

        it('should passthrough an already-formed Id object without a DB query', () => {
            const id = adapter.createId('passthrough');
            const resolved = adapter.resolveId(id);
            // Should return the exact same reference
            expect(resolved).toBe(id);
        });

        it('should coerce string, number, and Id inputs to the same Id', () => {
            const id = adapter.createId('coerce_target');

            // Access the protected `coerceId` method via bracket notation
            const adapterAny = adapter as any;

            const fromString = adapterAny.coerceId('coerce_target');
            expect(fromString.string).toBe(id.string);
            expect(fromString.number).toBe(id.number);

            const fromNumber = adapterAny.coerceId(id.number);
            expect(fromNumber.string).toBe(id.string);
            expect(fromNumber.number).toBe(id.number);

            const fromId = adapterAny.coerceId(id);
            expect(fromId).toBe(id); // same reference
        });

        it('should directly accept numeric input', () => {
            const id = adapter.createId(54321);
            expect(id.string).toBe('54321');
            expect(id.number).toBe(54321);
            expect(id.source).toBe(54321);
        });

        it('should throw for null / undefined input', () => {
            expect(() => (adapter as any).createId(null)).toThrow();
            expect(() => (adapter as any).createId(undefined)).toThrow();
        });
    });

    // ==========================================================
    // 4. 群组操作
    // ==========================================================
    describe('group operations', () => {
        beforeEach(async () => {
            await createAndStartAccount(adapter, { account_id: 'group_bot' });
        });

        it('should return default group list', async () => {
            const groups = await adapter.getGroupList('group_bot');

            expect(groups.length).toBeGreaterThanOrEqual(2);
            for (const g of groups) {
                expect(g.group_id.string).toBeTruthy();
                expect(g.group_id.number).toEqual(expect.any(Number));
                expect(g.group_name).toBeTruthy();
            }
            expect(groups.some((g) => g.group_name === '测试群1')).toBe(true);
            expect(groups.some((g) => g.group_name === '测试群2')).toBe(true);
        });

        it('should get specific group info', async () => {
            const group = await adapter.getGroupInfo('group_bot', {
                group_id: adapter.createId('100001'),
            });

            expect(group.group_name).toBe('测试群1');
            expect(group.member_count).toBe(50);
            expect(group.max_member_count).toBe(200);
        });

        it('should throw for non-existent group', async () => {
            await expect(
                adapter.getGroupInfo('group_bot', { group_id: adapter.createId('999999') }),
            ).rejects.toThrow('Group 999999 not found');
        });
    });

    // ==========================================================
    // 5. 用户操作
    // ==========================================================
    describe('user operations', () => {
        beforeEach(async () => {
            await createAndStartAccount(adapter, { account_id: 'user_bot' });
        });

        it('should return default friend list', async () => {
            const friends = await adapter.getFriendList('user_bot');

            expect(friends.length).toBeGreaterThanOrEqual(3);
            for (const f of friends) {
                expect(f.user_id.string).toBeTruthy();
                expect(f.user_id.number).toEqual(expect.any(Number));
                expect(f.user_name).toBeTruthy();
            }
            expect(friends.some((f) => f.user_name === '测试好友1')).toBe(true);
        });

        it('should get specific user info', async () => {
            const user = await adapter.getUserInfo('user_bot', {
                user_id: adapter.createId('10001'),
            });

            expect(user.user_name).toBe('测试好友1');
            expect(user.avatar).toBe('https://via.placeholder.com/100');
        });

        it('should throw for non-existent user', async () => {
            await expect(
                adapter.getUserInfo('user_bot', { user_id: adapter.createId('99999') }),
            ).rejects.toThrow('User 99999 not found');
        });
    });

    // ==========================================================
    // 6. 状态转换
    // ==========================================================
    describe('state transitions', () => {
        it('starts as Pending, becomes Online after start', async () => {
            const account = adapter.createAccount({
                platform: 'mock', account_id: 'st_bot', nickname: 'ST', latency: 0,
            } as any);
            adapter.accounts.set('st_bot', account);

            expect(account.status).toBe(AccountStatus.Pending);

            const ready = new Promise<void>((r) => account.client.once('ready', () => r()));
            await adapter.start('st_bot');
            await ready;

            expect(account.status).toBe(AccountStatus.Online);
        });

        it('becomes Offline after stop', async () => {
            const { account, config } = await createAndStartAccount(adapter, {
                account_id: 'off_bot',
            });

            expect(account.status).toBe(AccountStatus.Online);

            await adapter.stop(config.account_id);
            expect(account.status).toBe(AccountStatus.OffLine);
        });

        it('sets client.isRunning correctly', async () => {
            const { account } = await createAndStartAccount(adapter, {
                account_id: 'run_bot',
            });

            const bot = account.client as any;
            expect(bot.isActive()).toBe(true);

            await adapter.stop('run_bot');
            expect(bot.isActive()).toBe(false);
        });
    });

    // ==========================================================
    // 7. 删除消息
    // ==========================================================
    describe('deleteMessage', () => {
        beforeEach(async () => {
            await createAndStartAccount(adapter, { account_id: 'del_bot' });
        });

        it('should delete a sent message without error', async () => {
            const msg = await adapter.sendMessage('del_bot', {
                scene_type: 'group',
                scene_id: adapter.createId('100001'),
                message: [{ type: 'text', data: { text: 'delete me' } }],
            });

            await expect(
                adapter.deleteMessage('del_bot', { message_id: msg.message_id }),
            ).resolves.toBeUndefined();
        });

        it('should throw for non-existent account', async () => {
            await expect(
                adapter.deleteMessage('ghost', { message_id: adapter.createId('xxx') }),
            ).rejects.toThrow('Account ghost not found');
        });
    });

    // ==========================================================
    // 8. 自定义配置（自定义好友和群组）
    // ==========================================================
    describe('custom configuration', () => {
        it('should use custom friends and groups instead of defaults', async () => {
            const { account } = await createAndStartAccount(adapter, {
                account_id: 'custom_bot',
                friends: [
                    { user_id: 'c_f1', nickname: 'CustomFriend1' },
                    { user_id: 'c_f2', nickname: 'CustomFriend2' },
                ],
                groups: [
                    {
                        group_id: 'c_g1',
                        group_name: 'CustomGroup',
                        member_count: 10,
                        max_member_count: 100,
                    },
                ],
            });

            const friends = await adapter.getFriendList('custom_bot');
            expect(friends.length).toBe(2);
            expect(friends[0].user_name).toBe('CustomFriend1');

            const groups = await adapter.getGroupList('custom_bot');
            expect(groups.length).toBe(1);
            expect(groups[0].group_name).toBe('CustomGroup');

            const groupInfo = await adapter.getGroupInfo('custom_bot', {
                group_id: adapter.createId('c_g1'),
            });
            expect(groupInfo.member_count).toBe(10);
        });
    });

    // ==========================================================
    // 9. getLoginInfo
    // ==========================================================
    describe('getLoginInfo', () => {
        it('should return account id and nickname from config', async () => {
            const { account, config } = await createAndStartAccount(adapter, {
                account_id: 'login_bot',
                nickname: 'SuperBot',
            });

            const info = await adapter.getLoginInfo(config.account_id);

            expect(info.user_id.string).toBe(config.account_id);
            expect(info.user_id.number).toEqual(expect.any(Number));
            expect(info.user_name).toBe('SuperBot');
        });
    });
});
