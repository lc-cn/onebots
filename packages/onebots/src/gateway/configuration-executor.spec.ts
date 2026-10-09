import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeConfigurationRejectedError } from "@onebots/core";
import { GatewayConfigurationExecutor } from "./configuration-executor.js";
import type { GatewayStartMessage } from "./contracts.js";
import {
    isGatewayConfigurationRequest,
    isGatewayConfigurationReply,
    type GatewayConfigurationRequest,
    type GatewayConfigurationReply,
} from "./configuration-contracts.js";
import { createGatewayConfigurationSnapshot } from "../control/gateway-configuration-snapshot.js";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "private") }));

const roots: string[] = [];
afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-config-ipc-")));
    roots.push(root);
    const snapshot = createGatewayConfigurationSnapshot(root, { log_level: "off" });
    const identity: GatewayStartMessage = {
        type: "gateway.start",
        protocolVersion: 1,
        controlInstanceId: "manager",
        gatewayInstanceId: "gateway",
        configVersion: "0".repeat(64),
        dependencyVersion: "test",
        workspacePath: root,
        configPath: snapshot.configPath,
        selection: { adapters: [], protocols: [], applications: [] },
    };
    const request: GatewayConfigurationRequest = {
        type: "gateway.configuration",
        protocolVersion: 1,
        controlInstanceId: "manager",
        gatewayInstanceId: "gateway",
        requestId: "first",
        action: "apply",
        operationId: "original",
        expectedConfigVersion: identity.configVersion,
        nextConfigVersion: snapshot.configVersion,
        configPath: snapshot.configPath,
    };
    const query = { ...request, action: "query" as const, requestId: "query" };
    delete query.nextConfigVersion;
    delete query.configPath;
    return { identity, request, query };
}
function exchange(executor: GatewayConfigurationExecutor, request: GatewayConfigurationRequest) {
    return new Promise<GatewayConfigurationReply>(resolve => {
        expect(executor.handle(request, resolve)).toBe(true);
    });
}

it.each(["directory", "symlink", "hardlink", "oversized"] as const)(
    "Windows 的 %s 快照先用元数据拒绝，不启动 PowerShell 或账号应用",
    async entry => {
        const { identity, request } = fixture();
        const file = request.configPath!;
        if (entry === "directory") {
            fs.unlinkSync(file);
            fs.mkdirSync(file);
        } else if (entry === "symlink") {
            fs.unlinkSync(file);
            fs.mkdirSync(`${file}.target`);
            // junction 在 Windows 不要求符号链接特权；两平台 lstat 都识别重解析入口。
            fs.symlinkSync(`${file}.target`, file, "junction");
        } else if (entry === "hardlink") {
            fs.linkSync(file, `${file}.alias`);
        } else {
            fs.truncateSync(file, 8 * 1024 * 1024 + 1);
        }
        vi.stubGlobal("process", { ...process, platform: "win32" });
        vi.mocked(execFileSync).mockClear();
        const apply = vi.fn();
        const executor = new GatewayConfigurationExecutor(
            { applyRuntimeConfiguration: apply },
            identity,
            () => undefined,
        );
        expect(await exchange(executor, request)).toMatchObject({
            outcome: "succeeded",
            result: { status: "rejected" },
        });
        expect(execFileSync).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
    },
);

it("Windows 的有效快照仍须完成 ACL 核验才可应用", async () => {
    const { identity, request } = fixture();
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.mocked(execFileSync).mockClear();
    const apply = vi.fn(async () => ({
        status: "applied" as const,
        impact: {
            mode: "none" as const,
            accounts: [],
            protocols: [],
            dynamicFields: [],
            restartReasons: [],
        },
    }));
    const executor = new GatewayConfigurationExecutor(
        { applyRuntimeConfiguration: apply },
        identity,
        () => undefined,
    );
    expect(await exchange(executor, request)).toMatchObject({
        outcome: "succeeded",
        result: { status: "applied" },
    });
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(execFileSync).toHaveBeenCalledWith(
        "powershell.exe",
        expect.any(Array),
        expect.any(Object),
    );
    expect(apply).toHaveBeenCalledOnce();
});

it("拒绝首回包丢失后可查询确认未执行，不把查询失败当作原操作拒绝", async () => {
    const { identity, request, query } = fixture();
    let calls = 0;
    const executor = new GatewayConfigurationExecutor(
        {
            async applyRuntimeConfiguration() {
                calls++;
                throw new RuntimeConfigurationRejectedError("busy");
            },
        },
        identity,
        () => {
            throw new Error("不应同步");
        },
    );
    await new Promise<void>(resolve =>
        executor.handle(request, () => {
            resolve();
            throw new Error("断链");
        }),
    );
    expect(await exchange(executor, query)).toMatchObject({
        outcome: "succeeded",
        result: { status: "rejected", configVersion: request.expectedConfigVersion },
    });
    expect(await exchange(executor, { ...request, requestId: "duplicate" })).toMatchObject({
        outcome: "succeeded",
        result: { status: "rejected" },
    });
    expect(calls).toBe(1);
    expect(await exchange(executor, { ...query, operationId: "missing" })).toMatchObject({
        outcome: "unknown",
    });
});

it("原回执绑定原配置身份，后续版本查询不能用旧回执推进或回退上下文", async () => {
    const { identity, request, query } = fixture();
    let calls = 0;
    const executor = new GatewayConfigurationExecutor(
        {
            async applyRuntimeConfiguration() {
                calls++;
                return {
                    status: "applied",
                    impact: {
                        mode: "none",
                        accounts: [],
                        protocols: [],
                        dynamicFields: [],
                        restartReasons: [],
                    },
                };
            },
        },
        identity,
        () => {},
    );
    expect(await exchange(executor, request)).toMatchObject({
        outcome: "succeeded",
        result: { status: "applied" },
    });
    expect(await exchange(executor, query)).toMatchObject({ outcome: "succeeded" });
    expect(
        await exchange(executor, { ...query, expectedConfigVersion: request.nextConfigVersion! }),
    ).toMatchObject({ outcome: "rejected" });
    expect(await exchange(executor, { ...request, requestId: "duplicate" })).toMatchObject({
        outcome: "succeeded",
    });
    expect(calls).toBe(1);
});

it("IPC 拒绝访问器、Proxy 与多余字段，不执行用户钩子", () => {
    const { request } = fixture();
    let evaluated = false;
    const getter = {
        ...request,
        get configPath() {
            evaluated = true;
            return "secret";
        },
    };
    const proxy = new Proxy(request, {
        get() {
            throw new Error("不应访问");
        },
    });
    expect(isGatewayConfigurationRequest(getter)).toBe(false);
    expect(isGatewayConfigurationRequest(proxy)).toBe(false);
    expect(isGatewayConfigurationRequest({ ...request, token: "secret" })).toBe(false);
    expect(isGatewayConfigurationReply(getter)).toBe(false);
    expect(evaluated).toBe(false);
});

it("状态旁路抛错后原 applied 回执仍可查询，不重派", async () => {
    const { identity, request, query } = fixture();
    let calls = 0;
    const executor = new GatewayConfigurationExecutor(
        {
            async applyRuntimeConfiguration() {
                calls++;
                return {
                    status: "applied",
                    impact: {
                        mode: "none",
                        accounts: [],
                        protocols: [],
                        dynamicFields: [],
                        restartReasons: [],
                    },
                };
            },
        },
        identity,
        () => {
            throw new Error("状态发布失败");
        },
    );
    expect(await exchange(executor, request)).toMatchObject({
        outcome: "succeeded",
        result: { status: "applied", configVersion: request.nextConfigVersion },
    });
    expect(await exchange(executor, query)).toMatchObject({
        outcome: "succeeded",
        result: { status: "applied" },
    });
    expect(await exchange(executor, request)).toMatchObject({ outcome: "succeeded" });
    expect(calls).toBe(1);
});

it("原型污染缺失字段不执行 getter", () => {
    const { request } = fixture();
    let calls = 0;
    const candidate = { ...request };
    delete (candidate as Partial<GatewayConfigurationRequest>).action;
    Object.defineProperty(Object.prototype, "action", {
        configurable: true,
        get() {
            calls++;
            throw new Error("不允许原型读取");
        },
    });
    try {
        expect(isGatewayConfigurationRequest(candidate)).toBe(false);
        expect(calls).toBe(0);
    } finally {
        Reflect.deleteProperty(Object.prototype, "action");
    }
});

it("回执容量满后仍保留原操作证据，不淘汰后重派同编号", async () => {
    const { identity, request, query } = fixture();
    let calls = 0;
    const executor = new GatewayConfigurationExecutor(
        {
            async applyRuntimeConfiguration() {
                calls++;
                throw new RuntimeConfigurationRejectedError("busy");
            },
        },
        identity,
        () => {},
    );
    for (let index = 0; index < 4096; index++)
        await exchange(executor, {
            ...request,
            operationId: index ? `op-${index}` : request.operationId,
        });
    expect(await exchange(executor, { ...request, operationId: "full" })).toMatchObject({
        outcome: "rejected",
    });
    expect(await exchange(executor, query)).toMatchObject({
        outcome: "succeeded",
        result: { status: "rejected" },
    });
    expect(await exchange(executor, request)).toMatchObject({ outcome: "succeeded" });
    expect(calls).toBe(4096);
});
