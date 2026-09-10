import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";

const publisher = vi.hoisted(() => ({
    construct: vi.fn(),
    publish: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
}));
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

const roots: string[] = [];
afterEach(() => {
    vi.clearAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Windows原生宿主状态接线", () => {
    it("manager就绪前发布当前gateway状态且不创建未验收的本地HTTP管道", async () => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { ...platform, value: "win32" });
        const workspace = realpathSync(mkdtempSync(path.join(os.tmpdir(), "onebots-win-host-")));
        roots.push(workspace);
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
                expect.any(Function),
            );
            expect(publisher.publish).toHaveBeenCalledWith(
                expect.objectContaining({ desired: "running" }),
            );
            expect(host.socketPath).toBe(WINDOWS_HOST_PIPE_NAME);
            await host.close();
            expect(publisher.flush).toHaveBeenCalled();
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
