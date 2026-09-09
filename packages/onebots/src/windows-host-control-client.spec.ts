import { describe, expect, it, vi } from "vitest";
import { WindowsHostControlClient } from "./windows-host-control-client.js";

const pipe = "\\\\.\\pipe\\onebots-gateway-control";
const control = {
    manager: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        version: "1.2.12",
        pid: 42,
    },
    gateway: { desired: "running" as const, actual: "stopped" as const },
};

describe("Windows named pipe ControlClient边界", () => {
    it("发布闭合状态并校验响应requestId", async () => {
        const exchange = vi.fn(async (_pipe: string, bytes: Buffer) => {
            const request = JSON.parse(bytes.toString("utf8"));
            expect(request).toEqual({
                version: 1,
                requestId: expect.stringMatching(/^publish:/),
                operation: "publish_status",
                control,
            });
            return Buffer.from(
                JSON.stringify({
                    version: 1,
                    requestId: request.requestId,
                    ok: true,
                    state: {
                        service: "running",
                        manager: { state: "running", pid: 42 },
                        startedAt: "2026-09-10T00:00:00Z",
                        control,
                    },
                }) + "\r\n",
            );
        });
        const result = await new WindowsHostControlClient(pipe, exchange).publish(control);
        expect(result.state.control).toEqual(control);
        expect(exchange).toHaveBeenCalledWith(pipe, expect.any(Buffer), 5000);
    });

    it("拒绝远程管道、超期配置、错配响应及超限状态", async () => {
        expect(() => new WindowsHostControlClient("\\\\localhost\\pipe\\onebots")).toThrow();
        expect(() => new WindowsHostControlClient(pipe, undefined, 5001)).toThrow();
        const mismatch = new WindowsHostControlClient(pipe, async () =>
            Buffer.from(
                JSON.stringify({
                    version: 1,
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
});
