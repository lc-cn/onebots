import { describe, expect, it } from "vitest";
import type { Protocol } from "onebots";
import { zhinApplication } from "./index.js";

describe("Zhin Application", () => {
    it("只声明标准 API 依赖，不增加动作、路由或生命周期钩子", () => {
        const extension = zhinApplication.createProtocolExtension({
            name: "onebot",
            version: "v11",
            path: "/mock/main/onebot/v11",
        } as Protocol)!;

        expect(extension.capability).toMatchObject({
            actions: [],
            requiredActions: ["get_login_info", "send_private_msg"],
            unsupportedActions: [],
            routes: [],
            connections: [{ endpoint: "/mock/main/onebot/v11" }],
        });
        expect(extension.start).toBeUndefined();
        expect(extension.stop).toBeUndefined();
        expect(extension.apply).toBeUndefined();
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
