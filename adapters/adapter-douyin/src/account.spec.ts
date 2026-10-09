import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    clients: [] as FakeClient[],
    createClient: vi.fn(),
    projectMessage: vi.fn(() => ({ type: "message", id: "projected" })),
}));

class FakeSdkAccount extends EventEmitter {
    readonly login = vi.fn(async () => undefined);
    readonly logout = vi.fn(async () => undefined);
    readonly continueLogin = vi.fn(async () => undefined);
    readonly options: Record<string, unknown>;
    uid?: string;
    nickname?: string;
    profile?: { avatarThumb?: string };

    constructor(options: Record<string, unknown>) {
        super();
        this.options = options;
    }
}

class FakeClient {
    readonly accounts: FakeSdkAccount[] = [];
    readonly removeAccount = vi.fn(async () => {
        await this.accounts[0]?.logout();
        return true;
    });

    createAccount(options: Record<string, unknown>): FakeSdkAccount {
        const account = new FakeSdkAccount(options);
        this.accounts.push(account);
        return account;
    }
}

class FakeOneBotsAccount extends EventEmitter {
    status = "pending";
    nickname = "";
    avatar = "";
    readonly dispatchAwaited = vi.fn(async () => undefined);

    constructor(
        readonly adapter: unknown,
        readonly client: FakeSdkAccount,
        readonly config: Record<string, unknown>,
    ) {
        super();
    }
}

vi.doMock("douyin-im", () => ({
    createClient: (...args: unknown[]) => mocks.createClient(...args),
}));

vi.doMock("onebots", () => ({
    Account: FakeOneBotsAccount,
    AccountStatus: {
        Pending: "pending",
        Online: "online",
        OffLine: "offline",
    },
}));

vi.doMock("./events.js", () => ({
    projectDouyinMessage: (...args: unknown[]) => mocks.projectMessage(...args),
    projectDouyinGroupRequest: vi.fn(() => ({ type: "request" })),
    projectDouyinNotice: vi.fn(() => undefined),
}));

const { DouyinAccountFactory } = await import("./account.js");

interface FakeAdapter {
    app: { dataDir: string };
    emit: ReturnType<typeof vi.fn>;
    logger: {
        info: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
    };
    createId(value: string | number): { source: string | number; string: string; number: number };
    rememberGroupRequest: ReturnType<typeof vi.fn>;
    publishVerificationPage: ReturnType<typeof vi.fn>;
    revokeVerificationPage: ReturnType<typeof vi.fn>;
}

function createAdapter(): FakeAdapter {
    return {
        app: { dataDir: "/tmp/onebots-test" },
        emit: vi.fn(),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        createId: value => ({ source: value, string: String(value), number: Number(value) }),
        rememberGroupRequest: vi.fn(),
        publishVerificationPage: vi.fn(
            (_accountId: string, _type: string, _localUrl: string) =>
                "/_onebots/douyin-verification/proxy-token",
        ),
        revokeVerificationPage: vi.fn(),
    };
}

function createAccount(
    adapter: FakeAdapter,
    config: Record<string, unknown> = { account_id: "bot", login_method: "qr" },
): FakeOneBotsAccount {
    return new DouyinAccountFactory(adapter as never).create(config as never) as never;
}

async function invokeLifecycle(
    account: FakeOneBotsAccount,
    event: "start" | "stop",
    ...args: unknown[]
): Promise<void> {
    const listener = account.rawListeners(event)[0];
    if (!listener) throw new Error(`缺少 ${event} 生命周期监听器`);
    await Reflect.apply(listener, account, args);
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    mocks.clients.length = 0;
    mocks.createClient.mockReset().mockImplementation(() => {
        const client = new FakeClient();
        mocks.clients.push(client);
        return client;
    });
    mocks.projectMessage.mockClear();
});

describe("Douyin 账号生命周期", () => {
    it("按在线、离线和登录失败事件更新状态并清理验证", () => {
        const adapter = createAdapter();
        const account = createAccount(adapter);
        const sdk = account.client;

        sdk.emit("system.online", { screenName: "机器人", platformUid: "123" });
        expect(account.status).toBe("online");
        expect(account.nickname).toBe("机器人");

        sdk.emit("system.offline");
        expect(account.status).toBe("offline");

        adapter.emit.mockClear();
        sdk.emit("system.login.error", new Error("登录失败"));
        expect(account.status).toBe("offline");
        expect(adapter.emit).toHaveBeenCalledWith("verification:clear", {
            platform: "douyin",
            account_id: "bot",
        });
    });

    it("中止启动和 stop 共用同一个账号移除任务", async () => {
        const adapter = createAdapter();
        const account = createAccount(adapter);
        const client = mocks.clients[0]!;
        const removal = deferred<boolean>();
        client.removeAccount.mockImplementation(() => removal.promise);
        account.client.login.mockImplementation(() => new Promise<void>(() => undefined));

        const controller = new AbortController();
        void invokeLifecycle(account, "start", controller.signal);
        controller.abort();
        const stopping = invokeLifecycle(account, "stop");

        expect(client.removeAccount).toHaveBeenCalledTimes(1);
        removal.resolve(true);
        await stopping;
        expect(client.removeAccount).toHaveBeenCalledTimes(1);
        expect(account.status).toBe("offline");
    });

    it("重建同一别名时使用新 Client 和新登录配置，并只分发一次", async () => {
        const adapter = createAdapter();
        const factory = new DouyinAccountFactory(adapter as never);
        const first = factory.create({
            account_id: "bot",
            login_method: "password",
            mobile: "13800138000",
            password: "old-secret",
        } as never) as never as FakeOneBotsAccount;

        first.client.emit("message", { id: "before-stop" });
        expect(first.dispatchAwaited).toHaveBeenCalledTimes(1);
        await invokeLifecycle(first, "stop");

        const second = factory.create({
            account_id: "bot",
            login_method: "password",
            mobile: "13900139000",
            password: "new-secret",
        } as never) as never as FakeOneBotsAccount;

        expect(mocks.createClient).toHaveBeenCalledTimes(2);
        expect(first.client).not.toBe(second.client);
        expect(second.client.options).toMatchObject({
            accountId: "bot",
            login: { method: "password", mobile: "13900139000", password: "new-secret" },
        });

        first.client.emit("message", { id: "stale" });
        second.client.emit("message", { id: "fresh" });
        expect(first.dispatchAwaited).toHaveBeenCalledTimes(1);
        expect(second.dispatchAwaited).toHaveBeenCalledTimes(1);
    });
});

describe("Douyin 登录验证", () => {
    it("发布二维码并继续 SDK 登录流程", async () => {
        const adapter = createAdapter();
        const account = createAccount(adapter);

        account.client.emit("system.login.qrcode", {
            qrcodeBase64: "data:image/png;base64,cXJjb2Rl",
            expireTime: 60,
        });
        await Promise.resolve();

        expect(account.client.continueLogin).toHaveBeenCalledTimes(1);
        expect(adapter.emit).toHaveBeenCalledWith(
            "verification:request",
            expect.objectContaining({
                type: "qrcode",
                options: {
                    blocks: [{ type: "image", base64: "cXJjb2Rl", alt: "抖音登录二维码" }],
                },
            }),
        );
    });

    it("用新的短信或语音提示替换旧验证，并提供账号选择动作", () => {
        const adapter = createAdapter();
        const account = createAccount(adapter);
        const sdk = account.client;

        sdk.emit("system.login.sms-required", {
            mobile: "13800138000",
            reason: "需要先获取验证码",
        });
        sdk.emit("system.login.sms", { mobile: "13800138000", maskedMobile: "138****8000" });
        sdk.emit("system.login.voice", { mobile: "13800138000" });
        sdk.emit("system.login.accounts", {
            accounts: [
                {
                    secUid: "sec-1",
                    nickname: "主账号",
                    isActive: true,
                },
            ],
            canRegisterNewUser: true,
        });

        const requests = adapter.emit.mock.calls
            .filter(([event]) => event === "verification:request")
            .map(([, payload]) => payload as { type: string; actions?: { id: string }[] });
        expect(requests.map(request => request.type)).toEqual([
            "sms",
            "sms",
            "voice",
            "account-select",
        ]);
        expect(requests[3]?.actions?.map(action => action.id)).toEqual([
            "select:sec-1",
            "register-new",
        ]);
        expect(
            adapter.emit.mock.calls.filter(([event]) => event === "verification:clear"),
        ).toHaveLength(4);
    });

    it("旧浏览器验证完成时不会清掉同类型的新挑战", async () => {
        const adapter = createAdapter();
        const account = createAccount(adapter);
        const first = deferred<void>();
        const second = deferred<void>();

        account.client.emit("system.login.verification", {
            verification: {
                operation: "login",
                methods: ["captcha"],
                open: () => first.promise,
                openUrl: async () => "http://127.0.0.1:1234/?token=first",
                cancel: vi.fn(),
            },
        });
        account.client.emit("system.login.verification", {
            verification: {
                operation: "login",
                methods: ["captcha"],
                open: () => second.promise,
                openUrl: async () => "http://127.0.0.1:1235/?token=second",
                cancel: vi.fn(),
            },
        });
        const clearCount = () =>
            adapter.emit.mock.calls.filter(([event]) => event === "verification:clear").length;
        expect(clearCount()).toBe(2);
        await Promise.resolve();
        expect(adapter.publishVerificationPage).toHaveBeenCalledWith(
            "bot",
            "browser-verification",
            "http://127.0.0.1:1235/?token=second",
        );
        expect(adapter.emit).toHaveBeenCalledWith(
            "verification:request",
            expect.objectContaining({
                type: "browser-verification",
                options: expect.objectContaining({
                    blocks: expect.arrayContaining([
                        {
                            type: "link",
                            url: "/_onebots/douyin-verification/proxy-token",
                            label: "打开抖音安全验证页面",
                        },
                    ]),
                }),
            }),
        );

        first.resolve();
        await first.promise;
        await Promise.resolve();
        expect(clearCount()).toBe(2);

        second.resolve();
        await second.promise;
        await Promise.resolve();
        expect(clearCount()).toBe(3);
        expect(adapter.emit).toHaveBeenLastCalledWith("verification:clear", {
            platform: "douyin",
            account_id: "bot",
            type: "browser-verification",
        });
    });

    it("浏览器验证失败后撤销代理并清除不可重用的链接", async () => {
        const adapter = createAdapter();
        const account = createAccount(adapter);
        const completion = deferred<void>();

        account.client.emit("system.login.verification", {
            verification: {
                operation: "login",
                methods: ["captcha"],
                open: () => completion.promise,
                openUrl: async () => "http://127.0.0.1:1234/?token=failed",
                cancel: vi.fn(),
            },
        });
        await Promise.resolve();
        completion.reject(new Error("平台拒绝验证"));
        await completion.promise.catch(() => undefined);
        await Promise.resolve();

        expect(adapter.revokeVerificationPage).toHaveBeenLastCalledWith(
            "bot",
            "browser-verification",
        );
        expect(adapter.emit).toHaveBeenLastCalledWith("verification:clear", {
            platform: "douyin",
            account_id: "bot",
            type: "browser-verification",
        });
    });
});
