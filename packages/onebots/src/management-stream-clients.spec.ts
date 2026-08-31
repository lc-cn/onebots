import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { ManagementStreamClients } from "./management-stream-clients.js";

describe("management stream clients", () => {
    it("批量断开时执行全部清理与响应关闭，并允许随后重新注册", () => {
        const registry = new ManagementStreamClients();
        const healthyDispose = vi.fn();
        const healthyEnd = vi.fn();
        registry.register(
            {
                end: () => {
                    throw new Error("close failed");
                },
            } as unknown as ServerResponse,
            () => {
                throw new Error("dispose failed");
            },
        );
        registry.register({ end: healthyEnd } as unknown as ServerResponse, healthyDispose);

        expect(registry.disconnectAll()).toHaveLength(2);
        expect(healthyDispose).toHaveBeenCalledOnce();
        expect(healthyEnd).toHaveBeenCalledOnce();
        expect(registry.clients.size).toBe(0);

        const replacement = { end: vi.fn() } as unknown as ServerResponse;
        registry.register(replacement, vi.fn());
        expect(registry.clients.has(replacement)).toBe(true);
    });

    it("常规移除幂等执行清理且不主动结束已关闭响应", () => {
        const registry = new ManagementStreamClients();
        const dispose = vi.fn();
        const end = vi.fn();
        const client = { end } as unknown as ServerResponse;
        registry.register(client, dispose);

        registry.remove(client);
        registry.remove(client);

        expect(dispose).toHaveBeenCalledOnce();
        expect(end).not.toHaveBeenCalled();
    });

    it("响应结束同步触发断连回调时不会重复执行 disposer", () => {
        const registry = new ManagementStreamClients();
        const dispose = vi.fn();
        let client: ServerResponse;
        client = {
            end: () => registry.remove(client),
        } as unknown as ServerResponse;
        registry.register(client, dispose);

        registry.disconnectAll();

        expect(dispose).toHaveBeenCalledOnce();
    });
});
