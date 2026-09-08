import { ApplicationRegistry } from "@onebots/core";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./app.js", () => {
    throw new Error("框架注册不能依赖旧管理宿主");
});
import { loadPlugins } from "./runtime-plugins.js";

const promotedApplications = [
    "zhin",
    "avilla",
    "olivos",
    "zhamao",
    "shiro",
    "simbot-onebot",
    "overflow",
    "walle",
    "adachi-bot",
    "genshinuid",
    "pepperbot",
    "nonebot1",
] as const;

describe("built-in framework Applications", () => {
    afterEach(() => {
        for (const name of promotedApplications) ApplicationRegistry.deactivate(name);
    });

    it.each(promotedApplications)(
        "loads and activates %s through the -t runtime path",
        async name => {
            await expect(loadPlugins([], [], [name])).resolves.toEqual([]);
            expect(ApplicationRegistry.getActiveNames()).toContain(name);
            expect(ApplicationRegistry.get(name)?.stage).not.toBe("planned");
        },
    );
});
