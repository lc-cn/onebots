import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteDB } from "onebots";
import { describe, expect, it } from "vitest";
import { LineContextStore } from "./context-store.js";

describe("LineContextStore", () => {
    it("按账号隔离并更新聊天上下文", () => {
        withStore(store => {
            store.save("a", { id: "G1", type: "group", name: "旧名称" });
            store.save("a", { id: "G1", type: "group", name: "新名称" });
            store.save("b", { id: "G1", type: "room" });

            expect(store.list("a")).toHaveLength(1);
            expect(store.get("a", "G1")?.name).toBe("新名称");
            expect(store.get("b", "G1")?.type).toBe("room");
        });
    });

    it("持久化 Webhook 去重状态", () => {
        withStore(store => {
            expect(store.hasEvent("a", "evt-1")).toBe(false);
            store.saveEvent("a", "evt-1", 100);
            expect(store.hasEvent("a", "evt-1")).toBe(true);
            expect(store.hasEvent("b", "evt-1")).toBe(false);
        });
    });
});

function withStore(logic: (store: LineContextStore) => void): void {
    const file = join(tmpdir(), `onebots-line-${randomUUID()}.db`);
    const db = new SqliteDB(file);
    try {
        logic(new LineContextStore(db));
    } finally {
        db.close();
        rmSync(file, { force: true });
    }
}
