import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlMessageDebugSnapshot } from "@onebots/core/control";
import { MessageDebugController, messageDebugView } from "./control-message-debug-state";

const snapshot = (gatewayInstanceId = "first", seq = 1): ControlMessageDebugSnapshot => ({
    gatewayInstanceId,
    entries: [
        {
            seq,
            time: 1,
            direction: "inbound",
            platform: "mock",
            account_id: "001",
            payload: "<script>unsafe</script>",
        },
    ],
});
function fixture() {
    const client = {
        messageDebugHistory: vi.fn().mockResolvedValue(snapshot()),
        clearMessageDebug: vi.fn().mockResolvedValue({
            gatewayInstanceId: "first",
            clearedCount: 1,
            clearedThroughSeq: 1,
        }),
    };
    const view = messageDebugView();
    const controller = new MessageDebugController(client, view);
    controller.setGateway("first");
    return { client, view, controller };
}
afterEach(() => vi.useRealTimers());
describe("message debug view lifecycle", () => {
    it("does not read automatically until enabled and polls serially", async () => {
        vi.useFakeTimers();
        const f = fixture();
        let resolve!: (value: ControlMessageDebugSnapshot) => void;
        f.client.messageDebugHistory.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        await vi.advanceTimersByTimeAsync(3000);
        expect(f.client.messageDebugHistory).not.toHaveBeenCalled();
        f.controller.setAutomatic(true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(1);
        resolve(snapshot());
        await vi.advanceTimersByTimeAsync(999);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(2);
        f.controller.setAutomatic(false);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(2);
        f.controller.dispose();
    });
    it("pauses automatic reads while the activity page is hidden", async () => {
        vi.useFakeTimers();
        const f = fixture();
        f.controller.setAutomatic(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(1);
        f.controller.setActive(false);
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(1);
        f.controller.setActive(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.client.messageDebugHistory).toHaveBeenCalledTimes(2);
        f.controller.dispose();
    });
    it("discards responses from a replaced gateway and clears unavailable history", async () => {
        const f = fixture();
        let resolve!: (value: ControlMessageDebugSnapshot) => void;
        f.client.messageDebugHistory.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const read = f.controller.refresh();
        f.controller.setGateway("second");
        resolve(snapshot());
        await read;
        expect(f.view.entries).toEqual([]);
        f.client.messageDebugHistory.mockResolvedValue(snapshot("second", 1));
        await f.controller.refresh();
        expect(f.view.entries[0].seq).toBe(1);
        f.controller.setGateway(undefined);
        expect(f.view.entries).toEqual([]);
        expect(f.view.available).toBe(false);
    });
    it("does not let a revoked component's in-flight result retain messages", async () => {
        const f = fixture();
        let resolve!: (value: ControlMessageDebugSnapshot) => void;
        f.client.messageDebugHistory.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const read = f.controller.refresh();
        f.controller.dispose();
        resolve(snapshot());
        await read;
        expect(f.view.entries).toEqual([]);
        expect(f.view.available).toBe(false);
    });
    it("keeps unknown clear results visibly stale, pauses polling, never retries", async () => {
        const f = fixture();
        await f.controller.refresh();
        f.client.clearMessageDebug.mockRejectedValue(new Error("lost acknowledgement"));
        await f.controller.clear();
        expect(f.view.entries).toEqual(snapshot().entries);
        expect(f.view.available).toBe(false);
        expect(f.view.error).toContain("请手动刷新");
        await f.controller.clear();
        expect(f.client.clearMessageDebug).toHaveBeenCalledTimes(1);
        await f.controller.refresh();
        expect(f.view.available).toBe(true);
    });
    it("uses clear watermark to reject old snapshot entries without dropping newer ones", async () => {
        const f = fixture();
        await f.controller.refresh();
        await f.controller.clear();
        expect(f.view.entries).toEqual([]);
        f.client.messageDebugHistory.mockResolvedValue({
            ...snapshot(),
            entries: [...snapshot().entries, ...snapshot("first", 2).entries],
        });
        await f.controller.refresh();
        expect(f.view.entries.map(entry => entry.seq)).toEqual([2]);
        f.controller.setGateway("second");
        f.client.messageDebugHistory.mockResolvedValue(snapshot("second"));
        await f.controller.refresh();
        expect(f.view.entries.map(entry => entry.seq)).toEqual([1]);
    });
    it("rejects clear completion for an old instance and hides history on failed reads", async () => {
        const f = fixture();
        await f.controller.refresh();
        let resolve!: (value: unknown) => void;
        f.client.clearMessageDebug.mockImplementationOnce(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        const clear = f.controller.clear();
        f.controller.setGateway("second");
        resolve({ gatewayInstanceId: "first", clearedCount: 1, clearedThroughSeq: 99 });
        await clear;
        f.client.messageDebugHistory.mockResolvedValue(snapshot("second"));
        await f.controller.refresh();
        expect(f.view.entries).toHaveLength(1);
        f.client.messageDebugHistory.mockRejectedValue(new Error("offline"));
        await f.controller.refresh();
        expect(f.view.entries).toEqual([]);
        expect(f.view.available).toBe(false);
    });
});
