import { randomUUID } from "node:crypto";
import type { Adapter, BaseApp } from "@onebots/core";
import { describe, expect, it, vi } from "vitest";
import {
    GatewayVerificationExecutor,
    isGatewayVerificationCommand,
    type GatewayVerificationCommand,
} from "./verification-executor.js";
import { GatewayVerificationStore } from "./verification-store.js";
function fixture() {
    let now = 1000;
    const store = new GatewayVerificationStore(() => now);
    const context = { gatewayInstanceId: randomUUID(), configVersion: "test-config" };
    const submit = vi.fn(
        async (_account: string, _type: string, _data: Record<string, unknown>) => {},
    );
    const sms = vi.fn(async (_account: string) => {});
    const adapter = {
        accounts: new Map([
            ["bot", {}],
            ["other", {}],
        ]),
        submitVerification: submit,
        requestSmsCode: sms,
    };
    const adapters = new Map([["test", adapter]]);
    const app = { adapters } as unknown as Pick<BaseApp, "adapters">;
    const executor = new GatewayVerificationExecutor(app, store, context);
    const challenge = (overrides: Partial<Adapter.VerificationRequest> = {}) => {
        store.record({
            platform: "test",
            account_id: "bot",
            type: "sms",
            hint: "输入验证码",
            requestSmsAvailable: true,
            options: { blocks: [{ type: "input", key: "code", maxLength: 6 }] },
            ...overrides,
        });
        return store.list().at(-1)!;
    };
    const item = challenge();
    const command = (
        overrides: Partial<GatewayVerificationCommand> = {},
    ): GatewayVerificationCommand => ({
        operationId: randomUUID(),
        challengeId: item.id,
        expected: context,
        action: "submit",
        data: { code: "123456" },
        ...overrides,
    });
    return {
        store,
        context,
        adapters,
        adapter,
        submit,
        sms,
        executor,
        challenge,
        item,
        command,
        expire: () => {
            now += 31 * 60 * 1000;
        },
    };
}
function deferred() {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
describe("网关验证执行器", () => {
    it("使用挑战身份调用SDK，提交后完成原挑战；返回不是在线断言", async () => {
        const f = fixture();
        expect(await f.executor.execute(f.command())).toEqual({ outcome: "succeeded" });
        expect(f.submit).toHaveBeenCalledWith("bot", "sms", { code: "123456" });
        expect(f.store.get(f.item.id)).toBeUndefined();
    });
    it("短信请求必须明确允许，成功不清除待提交挑战", async () => {
        const f = fixture();
        expect(await f.executor.execute(f.command({ action: "request-sms", data: {} }))).toEqual({
            outcome: "succeeded",
        });
        expect(f.sms).toHaveBeenCalledOnce();
        expect(f.store.get(f.item.id)).toBeDefined();
        const item = f.challenge({ requestSmsAvailable: false });
        expect(
            await f.executor.execute(
                f.command({ challengeId: item.id, action: "request-sms", data: {} }),
            ),
        ).toEqual({ outcome: "rejected" });
        expect(f.sms).toHaveBeenCalledOnce();
    });
    it("同operation重放不重派发，内容冲突拒绝，回执对象不能被调用方篡改", async () => {
        const f = fixture(),
            pending = deferred(),
            command = f.command();
        f.submit.mockImplementation(() => pending.promise);
        const first = f.executor.execute(command),
            replay = f.executor.execute({ ...command, data: { code: "123456" } });
        expect(await f.executor.execute({ ...command, data: { code: "654321" } })).toEqual({
            outcome: "rejected",
        });
        await Promise.resolve();
        expect(f.submit).toHaveBeenCalledOnce();
        pending.resolve();
        const receipt = await first;
        receipt.outcome = "unknown";
        expect(await replay).toEqual({ outcome: "succeeded" });
        expect(await f.executor.execute(command)).toEqual({ outcome: "succeeded" });
        expect(f.submit).toHaveBeenCalledOnce();
    });
    it("不同验证类型按账号串行，其他账号可执行，实际settle才释放", async () => {
        const f = fixture(),
            pending = deferred();
        f.submit.mockImplementationOnce(() => pending.promise);
        const first = f.executor.execute(f.command());
        const next = f.challenge({ type: "pair_code" });
        expect(await f.executor.execute(f.command({ challengeId: next.id }))).toEqual({
            outcome: "rejected",
        });
        const other = f.challenge({ account_id: "other" });
        expect(await f.executor.execute(f.command({ challengeId: other.id }))).toEqual({
            outcome: "succeeded",
        });
        pending.resolve();
        await first;
        expect(await f.executor.execute(f.command({ challengeId: next.id }))).toEqual({
            outcome: "succeeded",
        });
    });
    it("排队微任务前挑战已替换或close则不派发SDK", async () => {
        for (const close of [false, true]) {
            const f = fixture();
            const operation = f.executor.execute(f.command());
            if (close) f.executor.close();
            else f.challenge();
            expect(await operation).toEqual({ outcome: "rejected" });
            expect(f.submit).not.toHaveBeenCalled();
        }
    });
    it("派发微任务前同ID账号或适配器被替换，不调用旧SDK或新SDK", async () => {
        for (const replaceAdapter of [false, true]) {
            const f = fixture();
            const replacementSubmit = vi.fn(async () => {});
            const operation = f.executor.execute(f.command());
            if (replaceAdapter)
                f.adapters.set("test", { ...f.adapter, submitVerification: replacementSubmit });
            else f.adapter.accounts.set("bot", {});
            expect(await operation).toEqual({ outcome: "rejected" });
            expect(f.submit).not.toHaveBeenCalled();
            expect(replacementSubmit).not.toHaveBeenCalled();
            expect(f.store.get(f.item.id)).toBeDefined();
        }
    });
    it("SDK执行期间同ID账号或适配器被替换，迟到结果unknown且不完成挑战", async () => {
        for (const replaceAdapter of [false, true]) {
            const f = fixture(),
                pending = deferred(),
                command = f.command();
            f.submit.mockImplementationOnce(() => pending.promise);
            const operation = f.executor.execute(command);
            await Promise.resolve();
            expect(f.submit).toHaveBeenCalledOnce();
            if (replaceAdapter) f.adapters.set("test", { ...f.adapter });
            else f.adapter.accounts.set("bot", {});
            pending.resolve();
            expect(await operation).toEqual({ outcome: "unknown" });
            expect(f.store.get(f.item.id)).toBeDefined();
            expect(await f.executor.execute(command)).toEqual({ outcome: "unknown" });
            expect(f.submit).toHaveBeenCalledOnce();
        }
    });
    it("提交期间出现新挑战时，旧提交完成不得删除新挑战", async () => {
        const f = fixture(),
            pending = deferred();
        f.submit.mockImplementation(() => pending.promise);
        const operation = f.executor.execute(f.command());
        await Promise.resolve();
        const replacement = f.challenge();
        pending.resolve();
        expect(await operation).toEqual({ outcome: "succeeded" });
        expect(f.store.list().map(item => item.id)).toEqual([replacement.id]);
    });
    it("SDK同步/异步异常均为unknown，同operation不重试", async () => {
        for (const asyncFailure of [false, true]) {
            const f = fixture(),
                command = f.command();
            f.submit.mockImplementation(() => {
                if (asyncFailure) return Promise.reject(new Error("secret"));
                throw new Error("secret");
            });
            expect(await f.executor.execute(command)).toEqual({ outcome: "unknown" });
            expect(await f.executor.execute(command)).toEqual({ outcome: "unknown" });
            expect(f.submit).toHaveBeenCalledOnce();
            expect(f.store.get(f.item.id)).toBeDefined();
        }
    });
    it("close不声称取消SDK，迟到结果unknown且不清除挑战", async () => {
        const f = fixture(),
            pending = deferred();
        f.submit.mockImplementation(() => pending.promise);
        const operation = f.executor.execute(f.command());
        await Promise.resolve();
        f.executor.close();
        pending.resolve();
        expect(await operation).toEqual({ outcome: "unknown" });
        expect(f.store.get(f.item.id)).toBeDefined();
        expect(await f.executor.execute(f.command())).toEqual({ outcome: "rejected" });
    });
    it("过期/不存在/旧实例/旧配置/不存在账号在派发前拒绝", async () => {
        const f = fixture();
        for (const command of [
            f.command({ challengeId: randomUUID() }),
            f.command({ expected: { ...f.context, gatewayInstanceId: randomUUID() } }),
            f.command({ expected: { ...f.context, configVersion: "old" } }),
        ]) {
            expect(await f.executor.execute(command)).toEqual({ outcome: "rejected" });
        }
        f.adapter.accounts.clear();
        expect(await f.executor.execute(f.command())).toEqual({ outcome: "rejected" });
        f.adapter.accounts.set("bot", {});
        f.expire();
        expect(await f.executor.execute(f.command())).toEqual({ outcome: "rejected" });
        expect(f.submit).not.toHaveBeenCalled();
    });
    it("输入严格使用声明字段和长度，action和confirm必须由挑战明确允许", async () => {
        const f = fixture();
        for (const data of [
            {},
            { code: "" },
            { code: "1234567" },
            { code: "123", platform: "other" },
            { action: "relogin" },
        ]) {
            expect(await f.executor.execute(f.command({ data }))).toEqual({ outcome: "rejected" });
        }
        const action = f.challenge({ actions: [{ id: "relogin", label: "重新登录" }] });
        expect(
            await f.executor.execute(
                f.command({ challengeId: action.id, data: { action: "relogin" } }),
            ),
        ).toEqual({ outcome: "succeeded" });
        const confirm = f.challenge({ options: { blocks: [] }, confirmable: true });
        expect(await f.executor.execute(f.command({ challengeId: confirm.id, data: {} }))).toEqual({
            outcome: "succeeded",
        });
    });
    it("command解析不调用访问器或Proxy，不接受额外字段或超限秘密", () => {
        const f = fixture(),
            getter = vi.fn(() => "123456"),
            trap = vi.fn();
        const data = Object.defineProperty({}, "code", { enumerable: true, get: getter });
        for (const value of [
            null,
            { ...f.command(), extra: 1 },
            { ...f.command(), operationId: "bad" },
            { ...f.command(), data },
            { ...f.command(), data: new Proxy({}, { ownKeys: trap }) },
            { ...f.command(), data: { code: "x".repeat(16385) } },
            { ...f.command(), data: { code: "line\nbreak" } },
        ])
            expect(isGatewayVerificationCommand(value)).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(trap).not.toHaveBeenCalled();
        expect(isGatewayVerificationCommand(f.command())).toBe(true);
    });
    it("已派发回执满时拒绝新操作，不淘汰旧回执以重新派发", async () => {
        const f = fixture(),
            first = f.command({ action: "request-sms", data: {} });
        expect(await f.executor.execute(first)).toEqual({ outcome: "succeeded" });
        for (let index = 1; index < 1024; index++)
            expect(
                await f.executor.execute(f.command({ action: "request-sms", data: {} })),
            ).toEqual({ outcome: "succeeded" });
        expect(await f.executor.execute(f.command({ action: "request-sms", data: {} }))).toEqual({
            outcome: "rejected",
        });
        expect(await f.executor.execute(first)).toEqual({ outcome: "succeeded" });
        expect(f.sms).toHaveBeenCalledTimes(1024);
    });
});

it("查询只读原回执，运行中不等待，晚到成功可查询且身份不可替换", async () => {
    const f = fixture(),
        pending = deferred(),
        command = f.command();
    f.submit.mockImplementation(() => pending.promise);
    const query = {
        operationId: command.operationId,
        challengeId: command.challengeId,
        verificationAction: command.action,
    };
    expect(f.executor.query(query)).toEqual({ state: "missing" });
    const result = f.executor.execute(command);
    expect(f.executor.query(query)).toEqual({ state: "running" });
    await Promise.resolve();
    expect(f.executor.query({ ...query, challengeId: randomUUID() })).toEqual({ state: "missing" });
    expect(f.executor.query({ ...query, verificationAction: "request-sms" })).toEqual({
        state: "missing",
    });
    expect(f.submit).toHaveBeenCalledOnce();
    pending.resolve();
    await result;
    expect(f.executor.query(query)).toEqual({ state: "succeeded" });
    f.executor.close();
    expect(f.executor.query(query)).toEqual({ state: "succeeded" });
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.sms).not.toHaveBeenCalled();
});
it("关闭不伪造运行中回执的终态，晚到 SDK 结果保留 unknown", async () => {
    const f = fixture(),
        pending = deferred(),
        command = f.command();
    f.submit.mockImplementation(() => pending.promise);
    const query = {
        operationId: command.operationId,
        challengeId: command.challengeId,
        verificationAction: command.action,
    };
    const result = f.executor.execute(command);
    await Promise.resolve();
    f.executor.close();
    expect(f.executor.query(query)).toEqual({ state: "running" });
    pending.resolve();
    await result;
    expect(f.executor.query(query)).toEqual({ state: "unknown" });
    expect(f.submit).toHaveBeenCalledOnce();
});
it("派发前关闭产生可查询 rejected 回执", async () => {
    const f = fixture(),
        command = f.command();
    const result = f.executor.execute(command);
    f.executor.close();
    await result;
    expect(
        f.executor.query({
            operationId: command.operationId,
            challengeId: command.challengeId,
            verificationAction: command.action,
        }),
    ).toEqual({ state: "rejected" });
    expect(f.submit).not.toHaveBeenCalled();
});
