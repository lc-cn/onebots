import { describe, expect, it, vi } from "vitest";
import {
    createWindowsNativeHostExchange,
    WindowsHostControlClient,
} from "./windows-host-control-client.js";

const pipe = "\\\\.\\pipe\\onebots-gateway-control";
const publishedAt = new Date().toISOString();
const control = {
    revision: 1,
    manager: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        version: "1.2.12",
        pid: 42,
    },
    gateway: { desired: "running" as const, actual: "stopped" as const },
};

describe("Windows named pipe ControlClient边界", () => {
    it("本地 CLI 通过随包原生桥以 stdin 传输请求", async () => {
        const runner = vi.fn(async () => Buffer.from("response"));
        const exchange = createWindowsNativeHostExchange("C:\\OneBots\\host.exe", runner);
        const request = Buffer.from('{"version":2}\n');
        await expect(exchange(pipe, request, 120_000)).resolves.toEqual(Buffer.from("response"));
        expect(runner).toHaveBeenCalledWith(
            "C:\\OneBots\\host.exe",
            ["exchange", "--pipe", pipe, "--timeout", "120000ms"],
            request,
            120_000,
        );
    });

    it("发布闭合状态并校验响应requestId", async () => {
        const exchange = vi.fn(async (_pipe: string, bytes: Buffer) => {
            const request = JSON.parse(bytes.toString("utf8"));
            expect(request).toEqual({
                version: 2,
                requestId: expect.stringMatching(/^publish:/),
                operation: "publish_status",
                control,
            });
            return Buffer.from(
                JSON.stringify({
                    version: 2,
                    requestId: request.requestId,
                    ok: true,
                    state: {
                        service: "running",
                        manager: { state: "running", pid: 42 },
                        startedAt: "2026-09-10T00:00:00Z",
                        control: { ...control, publishedAt },
                    },
                }) + "\r\n",
            );
        });
        const result = await new WindowsHostControlClient(pipe, exchange).publish(control);
        expect(result.state.control).toEqual({
            ...control,
            publishedAt,
        });
        expect(exchange).toHaveBeenCalledWith(pipe, expect.any(Buffer), 5000);
    });

    it("以manager身份和更高revision使旧状态失效", async () => {
        const exchange = vi.fn(async (_pipe: string, bytes: Buffer) => {
            const request = JSON.parse(bytes.toString("utf8"));
            expect(request).toEqual({
                version: 2,
                requestId: expect.stringMatching(/^invalidate:/),
                operation: "invalidate_status",
                manager: control.manager,
                revision: 2,
            });
            return Buffer.from(
                JSON.stringify({
                    version: 2,
                    requestId: request.requestId,
                    ok: true,
                    state: {
                        service: "running",
                        manager: { state: "running", pid: 42 },
                        startedAt: "2026-09-10T00:00:00Z",
                    },
                }) + "\n",
            );
        });
        expect(
            (await new WindowsHostControlClient(pipe, exchange).invalidate(control.manager, 2))
                .state.control,
        ).toBeUndefined();
    });

    it("拒绝远程管道、超期配置、错配响应及超限状态", async () => {
        expect(() => new WindowsHostControlClient("\\\\localhost\\pipe\\onebots")).toThrow();
        expect(() => new WindowsHostControlClient(pipe, undefined, 5001)).toThrow();
        const mismatch = new WindowsHostControlClient(pipe, async () =>
            Buffer.from(
                JSON.stringify({
                    version: 2,
                    requestId: "status:other",
                    ok: true,
                    state: {
                        service: "running",
                        manager: { state: "running", pid: 42 },
                        startedAt: "2026-09-10T00:00:00Z",
                    },
                }),
            ),
        );
        await expect(mismatch.status()).rejects.toThrow("响应与请求不匹配");
        await expect(
            new WindowsHostControlClient(pipe, async () => Buffer.alloc(65_537, 0x61)).status(),
        ).rejects.toThrow();
    });

    it("以刚读取的manager/revision绑定通用本地ControlTransport请求", async () => {
        const exchange = vi.fn(async (_pipe: string, bytes: Buffer, timeout: number) => {
            const request = JSON.parse(bytes.toString("utf8"));
            if (request.operation === "status")
                return Buffer.from(
                    JSON.stringify({
                        version: 2,
                        requestId: request.requestId,
                        ok: true,
                        state: {
                            service: "running",
                            manager: { state: "running", pid: 42 },
                            startedAt: "2026-09-10T00:00:00Z",
                            control: { ...control, publishedAt },
                        },
                    }) + "\n",
                );
            expect(timeout).toBe(120_000);
            expect(request).toEqual({
                version: 2,
                requestId: expect.stringMatching(/^control:/),
                operation: "control_request",
                binding: { revision: 1, manager: control.manager },
                method: "POST",
                route: "/api/control/auth/bootstrap",
                body: {},
            });
            return Buffer.from(
                JSON.stringify({
                    version: 2,
                    requestId: request.requestId,
                    ok: true,
                    result: { status: 201, body: { code: "123456" } },
                }) + "\n",
            );
        });
        await expect(
            new WindowsHostControlClient(pipe, exchange).request(
                "POST",
                "/api/control/auth/bootstrap",
                {},
            ),
        ).resolves.toEqual({ status: 201, body: { code: "123456" } });
        expect(exchange).toHaveBeenCalledTimes(2);
    });

    it("旧manager绑定由host拒绝后不伪造控制结果", async () => {
        const exchange = vi.fn(async (_pipe: string, bytes: Buffer) => {
            const request = JSON.parse(bytes.toString("utf8"));
            if (request.operation === "status")
                return Buffer.from(
                    JSON.stringify({
                        version: 2,
                        requestId: request.requestId,
                        ok: true,
                        state: {
                            service: "running",
                            manager: { state: "running", pid: 42 },
                            startedAt: "2026-09-10T00:00:00Z",
                            control: { ...control, publishedAt },
                        },
                    }) + "\n",
                );
            return Buffer.from(
                JSON.stringify({
                    version: 2,
                    requestId: request.requestId,
                    ok: false,
                    error: { code: "stale_binding", message: "manager changed" },
                }) + "\n",
            );
        });
        await expect(
            new WindowsHostControlClient(pipe, exchange).request("GET", "/api/control/status"),
        ).rejects.toThrow("manager changed");
    });

    it("控制结果可超过64KiB但仍受1MiB独立上限", async () => {
        const payload = "x".repeat(70 * 1024);
        const exchange = vi.fn(async (_pipe: string, bytes: Buffer) => {
            const request = JSON.parse(bytes.toString("utf8"));
            if (request.operation === "status")
                return Buffer.from(
                    JSON.stringify({
                        version: 2,
                        requestId: request.requestId,
                        ok: true,
                        state: {
                            service: "running",
                            manager: { state: "running", pid: 42 },
                            startedAt: "2026-09-10T00:00:00Z",
                            control: { ...control, publishedAt },
                        },
                    }),
                );
            return Buffer.from(
                JSON.stringify({
                    version: 2,
                    requestId: request.requestId,
                    ok: true,
                    result: { status: 200, body: { payload } },
                }),
            );
        });
        await expect(
            new WindowsHostControlClient(pipe, exchange).request("GET", "/api/control/status"),
        ).resolves.toEqual({ status: 200, body: { payload } });
        const tooLarge = new WindowsHostControlClient(pipe, async (_pipe, bytes) => {
            const request = JSON.parse(bytes.toString("utf8"));
            if (request.operation === "status") return exchange(_pipe, bytes, 5000);
            return Buffer.alloc(1024 * 1024 + 1, 0x61);
        });
        await expect(tooLarge.request("GET", "/api/control/status")).rejects.toThrow("大小无效");
    });
});
