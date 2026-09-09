import type { Adapter } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import { GatewayVerificationStore, isGatewayVerificationChallenge } from "./verification-store.js";

const request = (
    overrides: Partial<Adapter.VerificationRequest> = {},
): Adapter.VerificationRequest => ({
    platform: "mock",
    account_id: "1",
    type: "captcha",
    hint: "输入验证码",
    ...overrides,
});
const recordUnknown = (store: GatewayVerificationStore, value: unknown): void => {
    store.record(value as Adapter.VerificationRequest);
};

describe("GatewayVerificationStore", () => {
    it("挑战 ID 与共享客户端一致，拒绝无有效版本或 variant 的 UUID", () => {
        const store = new GatewayVerificationStore(() => 100);
        store.record(request());
        const challenge = store.list()[0];
        expect(isGatewayVerificationChallenge(challenge)).toBe(true);
        for (const id of [
            "00000000-0000-0000-0000-000000000000",
            "11111111-1111-4111-1111-111111111111",
        ])
            expect(isGatewayVerificationChallenge({ ...challenge, id })).toBe(false);
    });
    it("同一挑战重新出现时替换 UUID，旧完成回执不能清理新挑战", () => {
        const store = new GatewayVerificationStore(() => 100);
        store.record(request());
        const first = store.list()[0];
        expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
        store.record(request({ hint: "新的验证码" }));
        const second = store.list()[0];
        expect(second.id).not.toBe(first.id);
        expect(store.complete(first.id)).toBe(false);
        expect(store.get(first.id)).toBeUndefined();
        expect(store.list()).toEqual([second]);
        expect(store.complete(second.id)).toBe(true);
        expect(store.complete(second.id)).toBe(false);
    });

    it("30 分钟边界过期，过期挑战不能完成", () => {
        let now = 1_000;
        const store = new GatewayVerificationStore(() => now);
        store.record(request());
        const first = store.list()[0];
        expect(first).toMatchObject({ createdAt: now, expiresAt: now + 1_800_000 });
        now += 1_799_999;
        expect(store.get(first.id)).toBeDefined();
        now++;
        expect(store.get(first.id)).toBeUndefined();
        expect(store.complete(first.id)).toBe(false);
        expect(store.list()).toEqual([]);
    });

    it("保留最近 20 个，替换刷新容量顺序", () => {
        const store = new GatewayVerificationStore();
        for (let index = 0; index < 20; index++)
            store.record(request({ account_id: String(index) }));
        store.record(request({ account_id: "0" }));
        store.record(request({ account_id: "20" }));
        expect(store.list()).toHaveLength(20);
        expect(store.list().map(item => item.request.account_id)).toEqual([
            ...Array.from({ length: 18 }, (_, index) => String(index + 2)),
            "0",
            "20",
        ]);
    });

    it("输入、list 和 get 的嵌套数据全部隔离", () => {
        const store = new GatewayVerificationStore();
        const source = request({
            data: { nested: { content: "original" } },
            options: { blocks: [{ type: "input", key: "code", secret: true }] },
        });
        store.record(source);
        source.data!.nested = { content: "modified" };
        source.options!.blocks![0] = { type: "text", content: "modified" };
        const first = store.list()[0];
        first.request.data!.nested = null;
        store.get(first.id)!.request.hint = "modified";
        expect(store.get(first.id)!.request).toEqual(
            request({
                data: { nested: { content: "original" } },
                options: { blocks: [{ type: "input", key: "code", secret: true }] },
            }),
        );
    });

    it("JSON tuple 避免冒号碰撞，按账号或类型清理", () => {
        const store = new GatewayVerificationStore();
        store.record(request({ platform: "a:b", account_id: "c" }));
        store.record(request({ platform: "a", account_id: "b:c" }));
        store.record(request({ platform: "a", account_id: "b:c", type: "sms" }));
        expect(store.list()).toHaveLength(3);
        store.clear({ platform: "a", account_id: "b:c", type: "sms" });
        expect(store.list()).toHaveLength(2);
        store.clear({ platform: "a", account_id: "b:c" });
        expect(store.list()[0].request.platform).toBe("a:b");
    });

    it("拒绝循环、非 JSON 及坏字段而不污染已有挑战", () => {
        const store = new GatewayVerificationStore();
        store.record(request());
        const original = store.list();
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const invalid: unknown[] = [
            null,
            undefined,
            [],
            { ...request(), hint: " " },
            { ...request(), platform: 1 },
            { ...request(), unexpected: true },
            { ...request(), data: circular },
            { ...request(), data: { value: 1n } },
            { ...request(), data: { value: NaN } },
            { ...request(), data: { value: Infinity } },
            { ...request(), data: { value: undefined } },
            { ...request(), data: { value: () => 1 } },
            { ...request(), data: { value: Symbol() } },
            { ...request(), data: { value: new Date() } },
            { ...request(), data: { value: new Map() } },
            { ...request(), data: { value: Array(2) } },
            { ...request(), actions: [{ id: "a", label: "a", variant: "bad" }] },
            { ...request(), options: { blocks: [{ type: "input", key: "x", maxLength: -1 }] } },
            { ...request(), requestSmsAvailable: "yes" },
            { ...request(), confirmable: 1 },
            { ...request(), options: { blocks: [{ type: "unknown" }] } },
        ];
        for (const value of invalid) {
            expect(() => recordUnknown(store, value)).not.toThrow();
            expect(store.list()).toEqual(original);
        }
    });

    it("不执行 getter、toJSON 或代理 trap，隐藏或符号字段同样拒绝", () => {
        const store = new GatewayVerificationStore();
        store.record(request());
        const original = store.list();
        const getter = vi.fn(() => "bad");
        const toJSON = vi.fn(() => ({}));
        const trap = vi.fn(() => {
            throw new Error("不得执行");
        });
        const accessor = Object.defineProperty({}, "value", { enumerable: true, get: getter });
        const hidden = Object.defineProperty({}, "value", { value: "hidden" });
        for (const data of [
            accessor,
            hidden,
            { toJSON },
            { [Symbol("x")]: 1 },
            new Proxy({}, { getPrototypeOf: trap, ownKeys: trap }),
        ]) {
            recordUnknown(store, { ...request(), data });
            expect(store.list()).toEqual(original);
        }
        expect(getter).not.toHaveBeenCalled();
        expect(toJSON).not.toHaveBeenCalled();
        expect(trap).not.toHaveBeenCalled();
        const badClear = Object.defineProperty({ account_id: "1" }, "platform", { get: getter });
        store.clear(badClear as Adapter.VerificationClear);
        expect(getter).not.toHaveBeenCalled();
        expect(store.list()).toEqual(original);
    });

    it("保留所有受支持的验证块、动作与请求元数据", () => {
        const store = new GatewayVerificationStore();
        const source = request({
            request_id: "platform-request-1",
            requestSmsAvailable: true,
            confirmable: true,
            confirmLabel: "继续",
            actions: [{ id: "login", label: "重新登录", variant: "primary" }],
            data: { nested: [null, true, 123, "text"] },
            options: {
                blocks: [
                    { type: "image", base64: "abc", alt: "图片" },
                    { type: "image_url", url: "https://example.test/image" },
                    { type: "qrcode", content: "scan" },
                    { type: "link", url: "https://example.test/login", label: "验证" },
                    { type: "text", content: "提示" },
                    {
                        type: "input",
                        key: "code",
                        placeholder: "验证码",
                        secret: true,
                        maxLength: 6,
                    },
                ],
            },
        });
        store.record(source);
        expect(store.list()[0].request).toEqual(source);
    });

    it("允许二维码大请求，完整 JSON 的 UTF-8 上限为 1 MiB", () => {
        const store = new GatewayVerificationStore();
        const base = request({ options: { blocks: [{ type: "image", base64: "" }] } });
        const overhead = Buffer.byteLength(JSON.stringify(base));
        const fitting = request({
            options: { blocks: [{ type: "image", base64: "x".repeat(1024 * 1024 - overhead) }] },
        });
        store.record(fitting);
        expect(store.list()).toHaveLength(1);
        const original = store.list();
        fitting.hint += "中";
        store.record(fitting);
        expect(store.list()).toEqual(original);
    });
});
