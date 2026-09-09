import { describe, expect, it, vi } from "vitest";
import type { WindowsNativeStatus } from "./service-platform-windows.js";
import type { WindowsPublishedControlStatus } from "./windows-host-control-client.js";
import {
    completeWindowsGatewayOperation,
    WindowsManagerStatusPublisher,
} from "./windows-manager-status-publisher.js";

const manager = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    version: "1.2.12",
    pid: 8765,
};

function response(control?: WindowsPublishedControlStatus): WindowsNativeStatus {
    return {
        version: 2,
        requestId: "publish:test",
        ok: true,
        state: {
            service: "running",
            manager: { state: "running", pid: manager.pid },
            startedAt: "2026-09-10T01:02:03Z",
            ...(control ? { control: { ...control, publishedAt: "2026-09-10T01:02:03Z" } } : {}),
        },
    };
}

describe("Windows manager状态发布", () => {
    it("发布真实manager身份与gateway状态并要求原生宿主回读确认", async () => {
        const publish = vi.fn(async (control: WindowsPublishedControlStatus) => response(control));
        const invalidate = vi.fn(async () => response());
        const publisher = new WindowsManagerStatusPublisher(
            "\\\\.\\pipe\\onebots-gateway-control",
            manager,
            {
                publish,
                invalidate,
            },
        );
        await publisher.publish({ desired: "running", actual: "stopped" });
        expect(publish).toHaveBeenCalledWith({
            revision: 1,
            manager,
            gateway: { desired: "running", actual: "stopped" },
        });
    });

    it("宿主未确认同一状态时拒绝成功", async () => {
        const publisher = new WindowsManagerStatusPublisher(
            "\\\\.\\pipe\\onebots-gateway-control",
            manager,
            {
                publish: vi.fn(async () => response()),
                invalidate: vi.fn(async () => response()),
            },
        );
        await expect(publisher.publish({ desired: "stopped", actual: "stopped" })).rejects.toThrow(
            "未确认当前管理状态",
        );
    });

    it("公开写操作在原生宿主确认最终状态前不返回", async () => {
        let confirm!: () => void;
        const confirmation = new Promise<void>(resolve => {
            confirm = resolve;
        });
        const publisher = {
            invalidate: vi.fn(async () => undefined),
            confirm: vi.fn(async () => confirmation),
        } as unknown as WindowsManagerStatusPublisher;
        let settled = false;
        const operation = completeWindowsGatewayOperation(
            async () => ({ status: "succeeded" }),
            () => ({ desired: "running", actual: "running" }),
            publisher,
        ).then(value => {
            settled = true;
            return value;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(publisher.invalidate).toHaveBeenCalledOnce();
        await vi.waitFor(() => {
            expect(publisher.confirm).toHaveBeenCalledWith({
                desired: "running",
                actual: "running",
            });
        });
        confirm();
        await expect(operation).resolves.toEqual({ status: "succeeded" });
    });

    it("最终状态发布失败时不向调用方宣告网关操作完成", async () => {
        const publisher = {
            invalidate: vi.fn(async () => undefined),
            confirm: vi.fn(async () => {
                throw new Error("pipe unavailable");
            }),
        } as unknown as WindowsManagerStatusPublisher;
        await expect(
            completeWindowsGatewayOperation(
                async () => ({ status: "succeeded" }),
                () => ({ desired: "stopped", actual: "stopped" }),
                publisher,
            ),
        ).rejects.toThrow("pipe unavailable");
    });

    it("旧快照失效确认前不派发网关写入", async () => {
        let invalidate!: () => void;
        const invalidated = new Promise<void>(resolve => {
            invalidate = resolve;
        });
        const operation = vi.fn(async () => ({ status: "succeeded" }));
        const publisher = {
            invalidate: vi.fn(async () => invalidated),
            confirm: vi.fn(async () => undefined),
        } as unknown as WindowsManagerStatusPublisher;
        const completion = completeWindowsGatewayOperation(
            operation,
            () => ({ desired: "stopped", actual: "stopped" }),
            publisher,
        );
        await Promise.resolve();
        expect(operation).not.toHaveBeenCalled();
        invalidate();
        await completion;
        expect(operation).toHaveBeenCalledOnce();
        expect(publisher.confirm).toHaveBeenCalledOnce();
    });

    it("失效窗口内忽略heartbeat，最终确认才重新发布", async () => {
        const publish = vi.fn(async (control: WindowsPublishedControlStatus) => response(control));
        const invalidate = vi.fn(async () => response());
        const publisher = new WindowsManagerStatusPublisher(
            "\\\\.\\pipe\\onebots-gateway-control",
            manager,
            { publish, invalidate },
        );
        await publisher.publish({ desired: "running", actual: "running" });
        await publisher.invalidate();
        await publisher.publish({ desired: "running", actual: "running" });
        expect(publish).toHaveBeenCalledTimes(1);
        await publisher.confirm({ desired: "stopped", actual: "stopped" });
        expect(publish).toHaveBeenCalledTimes(2);
        expect(publish.mock.calls[1][0]).toMatchObject({
            revision: 3,
            gateway: { desired: "stopped", actual: "stopped" },
        });
    });
});
