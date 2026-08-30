import { describe, expect, test } from "vitest";
import { KookMessageContextStore } from "./message-context.js";

describe("KOOK 消息场景缓存", () => {
    test("保持有界并在刷新消息后淘汰最旧上下文", () => {
        const store = new KookMessageContextStore(2);
        store.remember("first", { scene: "channel", targetId: "channel-1" });
        store.remember("second", { scene: "direct", targetId: "user-1" });
        store.remember("first", { scene: "channel", targetId: "channel-2" });
        store.remember("third", { scene: "direct", targetId: "user-2" });

        expect(store.get("second")).toBeUndefined();
        expect(store.get("first")).toEqual({ scene: "channel", targetId: "channel-2" });
        expect(store.get("third")).toEqual({ scene: "direct", targetId: "user-2" });
    });

    test("忽略空消息 ID", () => {
        const store = new KookMessageContextStore();
        store.remember("", { scene: "channel" });
        expect(store.get("")).toBeUndefined();
    });
});
