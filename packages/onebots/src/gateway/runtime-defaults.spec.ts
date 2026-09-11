import { afterEach, expect, it, vi } from "vitest";
vi.mock("../app.js", () => {
    throw new Error("网关不得导入旧管理宿主");
});
import { GatewayApp } from "./app.js";
import { BaseApp } from "@onebots/core";
import {
    mergeRuntimeConfigDefaults,
    registerProtocolDefaults,
    runtimeDefaultConfig,
} from "../runtime-defaults.js";

const original = runtimeDefaultConfig.general;
afterEach(() => {
    runtimeDefaultConfig.general = original;
});

it("网关和协议默认注册不依赖旧 App，用户覆盖不会污染注册表", () => {
    expect(GatewayApp.prototype).toBeInstanceOf(BaseApp);
    const registered = { use_http: true, use_ws: false, heartbeat_interval: 15000 };
    registerProtocolDefaults("onebot.v11", registered);
    registered.heartbeat_interval = 1;
    const merged = mergeRuntimeConfigDefaults({ general: { "onebot.v11": { use_ws: true } } });
    expect(merged.general?.["onebot.v11"]).toEqual({
        use_http: true,
        use_ws: true,
        heartbeat_interval: 15000,
    });
    merged.general!["onebot.v11"]!.heartbeat_interval = 2;
    expect(mergeRuntimeConfigDefaults({}).general?.["onebot.v11"]?.heartbeat_interval).toBe(15000);
});
