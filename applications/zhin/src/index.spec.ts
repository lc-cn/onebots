import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Protocol, WsServer } from "onebots";
import { zhinApplication } from "./index.js";

describe("Zhin Application", () => {
    it("为 OneBot 11 增加专用路由、能力动作和生命周期", async () => {
        const server = Object.assign(new EventEmitter(), { close: vi.fn() }) as unknown as WsServer;
        const protocol = {
            name: "onebot",
            version: "v11",
            path: "/mock/main/onebot/v11",
            router: { ws: vi.fn(() => server) },
            logger: { info: vi.fn(), error: vi.fn() },
        } as unknown as Protocol;
        const extension = zhinApplication.createProtocolExtension(protocol);
        expect(extension?.capability).toMatchObject({
            routes: ["/mock/main/onebot/v11/applications/zhin"],
            actions: expect.arrayContaining(["get_zhin_application_info"]),
        });

        const next = vi.fn(async () => undefined);
        await extension?.start?.({ protocol, next });
        expect(next).toHaveBeenCalledOnce();
        expect(protocol.router.ws).toHaveBeenCalledWith("/mock/main/onebot/v11/applications/zhin");

        const result = await extension?.apply?.({
            protocol,
            action: "get_zhin_application_info",
            next: vi.fn(),
        });
        expect(result).toMatchObject({
            status: "ok",
            data: { application: "zhin", protocol: "onebot.v11" },
        });

        await extension?.stop?.({ protocol, next });
        expect(server.close).toHaveBeenCalledOnce();
    });

    it("对其他协议返回未支持", () => {
        expect(
            zhinApplication.createProtocolExtension({
                name: "satori",
                version: "v1",
            } as Protocol),
        ).toBeUndefined();
    });
});
