import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";

const publisher = vi.hoisted(() => ({
    construct: vi.fn(),
    publish: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    publishRejected: vi.fn(async () => undefined),
}));
const source = vi.hoisted(() => ({ state: "verified", release: vi.fn(), auth: vi.fn() }));
const context = {
    authorityId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    bindingRevision: 1,
    operationId: "33333333-3333-4333-8333-333333333333",
};
vi.mock("../workspace-admission/admission.js", () => ({
    acquireWorkspaceAdmission: () => ({
        inspection: {
            schemaVersion: 1,
            state: source.state,
            reason:
                source.state === "verified"
                    ? "REGISTERED_LOCAL_OBJECT"
                    : "EXPLICIT_REGISTRATION_REQUIRED",
        },
        binding:
            source.state === "verified"
                ? {
                      schemaVersion: 1,
                      authorityId: "11111111-1111-4111-8111-111111111111",
                      workspaceId: "22222222-2222-4222-8222-222222222222",
                      bindingRevision: 1,
                      operationId: "33333333-3333-4333-8333-333333333333",
                  }
                : undefined,
        release: source.release,
    }),
}));
vi.mock("../windows-private-file.js", () => ({
    createWindowsPrivateDirectory: (directory: string) => mkdirSync(directory, { mode: 0o700 }),
    inspectWindowsPrivateFile: vi.fn(),
}));
vi.mock("../service-host.js", () => ({
    createDefaultServiceHost: () => ({ platform: "win32", homedir: "C:\\fixture", env: {} }),
}));
vi.mock("./workspace.js", async original => {
    const actual = await original<typeof import("./workspace.js")>();
    return {
        ...actual,
        acquireControlWorkspace: (directory: string) => actual.acquireControlWorkspace(directory),
    };
});
vi.mock("./auth.js", async original => {
    const actual = await original<typeof import("./auth.js")>();
    return {
        ...actual,
        ControlAuth: class extends actual.ControlAuth {
            constructor(options: ConstructorParameters<typeof actual.ControlAuth>[0]) {
                source.auth();
                super(options);
            }
        },
    };
});
vi.mock("../windows-manager-status-publisher.js", () => ({
    WindowsManagerStatusPublisher: class {
        constructor(...args: unknown[]) {
            publisher.construct(...args);
        }
        publish(state: unknown) {
            return publisher.publish(state);
        }
        flush() {
            return publisher.flush();
        }
        publishRejected() {
            return publisher.publishRejected();
        }
    },
    completeWindowsGatewayOperation: async (operation: () => Promise<unknown>) => operation(),
}));
vi.mock("./http-utils.js", async importOriginal => ({
    ...(await importOriginal<typeof import("./http-utils.js")>()),
    listen: vi.fn(async () => undefined),
}));
vi.mock("../windows-manager-rpc.js", () => ({
    connectWindowsManagerRPC: vi.fn(async () => new net.Socket()),
}));
import { startControlHost } from "./host.js";
import { planAuthenticationBinding, applyAuthenticationBinding } from "./auth-binding.js";
import { planWorkspaceProcessGenesis } from "../service-process-genesis.js";

const roots: string[] = [];
afterEach(() => {
    vi.clearAllMocks();
    source.state = "verified";
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Windows原生宿主状态接线", () => {
    it("manager就绪前发布当前gateway状态且不创建未验收的本地HTTP管道", async () => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { ...platform, value: "win32" });
        const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "onebots-win-host-")));
        roots.push(workspace);
        mkdirSync(path.join(workspace, ".control"), { mode: 0o700 });
        // Wiring fixture only: native/source proofs are mocked; no Windows platform claim.
        Object.defineProperty(process, "platform", platform);
        applyAuthenticationBinding(workspace, planAuthenticationBinding(workspace, context));
        writeFileSync(
            path.join(workspace, ".control/gateway.json"),
            planWorkspaceProcessGenesis("stopped")["gateway.json"],
            { mode: 0o600 },
        );
        Object.defineProperty(process, "platform", { ...platform, value: "win32" });
        try {
            const host = await startControlHost({
                workspace,
                port: 0,
                windowsHostPipe: WINDOWS_HOST_PIPE_NAME,
                windowsHostRpcPipe:
                    "\\\\.\\pipe\\onebots-manager-rpc-0123456789abcdef0123456789abcdef",
            });
            expect(publisher.construct).toHaveBeenCalledWith(
                WINDOWS_HOST_PIPE_NAME,
                {
                    id: host.id,
                    version: expect.stringMatching(/^\d+\.\d+\.\d+/),
                    pid: process.pid,
                },
                undefined,
                { onFailure: expect.any(Function) },
            );
            expect(publisher.publish).toHaveBeenCalledWith(
                expect.objectContaining({ desired: "stopped" }),
            );
            expect(host.socketPath).toBe(WINDOWS_HOST_PIPE_NAME);
            await host.close();
            expect(publisher.flush).toHaveBeenCalled();
        } finally {
            Object.defineProperty(process, "platform", platform);
        }
    });

    it("native=true 不能绕过来源拒绝，只发布 rejected 且不构造认证/网关", async () => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "onebots-win-denied-")));
        roots.push(workspace);
        source.state = "unbound";
        Object.defineProperty(process, "platform", { ...platform, value: "win32" });
        try {
            const host = await startControlHost({
                workspace,
                port: 0,
                windowsHostPipe: WINDOWS_HOST_PIPE_NAME,
                windowsHostRpcPipe:
                    "\\\\.\\pipe\\onebots-manager-rpc-0123456789abcdef0123456789abcdef",
            });
            expect(host.admission.state).toBe("unbound");
            expect(host.controller).toBeUndefined();
            expect(publisher.publishRejected).toHaveBeenCalledOnce();
            expect(publisher.publish).not.toHaveBeenCalled();
            expect(source.auth).not.toHaveBeenCalled();
            expect(existsSync(path.join(workspace, ".control/auth.json"))).toBe(false);
            expect(existsSync(path.join(workspace, ".control/gateway.json"))).toBe(false);
            await host.close();
        } finally {
            Object.defineProperty(process, "platform", platform);
        }
    });

    it("非Windows进程不能启用原生宿主管道模式", async () => {
        await expect(
            startControlHost({ workspace: process.cwd(), windowsHostPipe: WINDOWS_HOST_PIPE_NAME }),
        ).rejects.toThrow("Windows 原生宿主管道无效");
        expect(publisher.construct).not.toHaveBeenCalled();
    });
});
