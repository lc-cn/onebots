import { describe, expect, it, vi } from "vitest";
import { ReliableEventIngress, type EventDeliveryStore } from "./reliable-event-ingress.js";

describe("ReliableEventIngress", () => {
    it("只在成功后提交事件身份", async () => {
        const ingress = new ReliableEventIngress<string>();
        const dispatch = vi.fn();

        await expect(ingress.deliver("event-1", dispatch)).resolves.toBe(true);
        await expect(ingress.deliver("event-1", dispatch)).resolves.toBe(false);
        expect(dispatch).toHaveBeenCalledOnce();
    });

    it("合并并发投递并区分首个调用与跟随者", async () => {
        let release: (() => void) | undefined;
        const dispatch = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );
        const ingress = new ReliableEventIngress<string>();

        const first = ingress.deliver("event-1", dispatch);
        const follower = ingress.deliver("event-1", dispatch);
        await Promise.resolve();
        expect(dispatch).toHaveBeenCalledOnce();
        release?.();

        await expect(Promise.all([first, follower])).resolves.toEqual([true, false]);
    });

    it("失败时通知全部等待者并允许重投", async () => {
        const ingress = new ReliableEventIngress<string>();
        const failure = new Error("delivery failed");
        const dispatch = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);

        const first = ingress.deliver("event-1", dispatch);
        const follower = ingress.deliver("event-1", dispatch);
        await expect(Promise.all([first, follower])).rejects.toBe(failure);
        await expect(ingress.deliver("event-1", dispatch)).resolves.toBe(true);
        expect(dispatch).toHaveBeenCalledTimes(2);
    });

    it("支持持久化投递存储", async () => {
        const keys = new Set<string>(["existing"]);
        const store: EventDeliveryStore<string> = {
            has: key => keys.has(key),
            commit: key => keys.add(key),
        };
        const ingress = new ReliableEventIngress(store);

        await expect(ingress.deliver("existing", vi.fn())).resolves.toBe(false);
        await expect(ingress.deliver("new", vi.fn())).resolves.toBe(true);
        expect(keys).toEqual(new Set(["existing", "new"]));
    });
});
