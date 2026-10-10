import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { Adapter } from "onebots";
import { SatoriChannelRouteRegistry } from "../channel-routes.js";

const adapter = {
    describeCapabilities: () => ({ actions: { get_group_info: true, get_channel_info: true } }),
} as unknown as Adapter;

describe("SatoriChannelRouteRegistry 持久化", () => {
    test("重启后可恢复已登记的路由", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satori-routes-"));
        const file = path.join(dir, "nested", "qq-bot.json");
        try {
            new SatoriChannelRouteRegistry(adapter, "bot", file).remember("ch-1", {
                scene_type: "channel",
                scene_id: "ch-1",
                guild_id: "g-1",
            });

            const restored = new SatoriChannelRouteRegistry(adapter, "bot", file);
            expect(restored.resolve("ch-1")).toEqual({
                scene_type: "channel",
                scene_id: "ch-1",
                guild_id: "g-1",
            });
            expect(() => restored.resolve("unknown")).toThrow("无法确定 channel_id unknown");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("损坏的存档文件视为空", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satori-routes-"));
        const file = path.join(dir, "bad.json");
        try {
            fs.writeFileSync(file, "{not json");
            const registry = new SatoriChannelRouteRegistry(adapter, "bot", file);
            expect(() => registry.resolve("x")).toThrow("无法确定 channel_id x");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
