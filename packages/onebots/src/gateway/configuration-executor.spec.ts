import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
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

const roots: string[] = [];
afterEach(() => {
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
