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
            const first = new SatoriChannelRouteRegistry(adapter, "bot", file);
            first.remember("ch-1", { scene_type: "channel", scene_id: "ch-1", guild_id: "g-1" });
            first.flush();

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

    test("忽略格式非法的路由并合并并发写入", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satori-routes-"));
        const file = path.join(dir, "routes.json");
        try {
            fs.writeFileSync(
                file,
                JSON.stringify({
                    bad1: { scene_type: "weird", scene_id: "x" },
                    bad2: { scene_type: "group", scene_id: 1 },
                    ok: { scene_type: "group", scene_id: "ok" },
                }),
            );
            const a = new SatoriChannelRouteRegistry(adapter, "bot", file);
            const b = new SatoriChannelRouteRegistry(adapter, "bot", file);
            expect(() => a.resolve("bad1")).toThrow();
            expect(() => a.resolve("bad2")).toThrow();
            a.remember("a", { scene_type: "channel", scene_id: "a" });
            b.remember("b", { scene_type: "channel", scene_id: "b" });
            a.flush();
            b.flush();

            const restored = new SatoriChannelRouteRegistry(adapter, "bot", file);
            expect(restored.resolve("a").scene_id).toBe("a");
            expect(restored.resolve("b").scene_id).toBe("b");
            expect(restored.resolve("ok").scene_type).toBe("group");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
