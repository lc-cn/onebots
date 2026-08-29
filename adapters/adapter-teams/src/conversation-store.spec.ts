import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDB } from "onebots";
import { TeamsConversationStore } from "./conversation-store.js";

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("TeamsConversationStore", () => {
    it("持久化并更新真实会话引用和消息上下文", () => {
        const directory = mkdtempSync(join(tmpdir(), "onebots-teams-store-"));
        tempDirectories.push(directory);
        const db = new SqliteDB(join(directory, "test.db"));
        const store = new TeamsConversationStore(db);
        const reference = {
            conversation: { id: "conversation-1", name: "General", isGroup: true },
            channelId: "msteams",
            serviceUrl: "https://smba.trafficmanager.net/teams/",
        };

        store.saveReference("account-1", reference);
        store.saveReference("account-1", {
            ...reference,
            conversation: { ...reference.conversation, name: "Renamed" },
        });
        store.saveMessageContext("account-1", "message-1", "conversation-1");

        expect(store.getReference("account-1", "conversation-1")?.conversation.name).toBe(
            "Renamed",
        );
        expect(store.listReferences("account-1")).toHaveLength(1);
        expect(store.findConversationByMessage("account-1", "message-1")).toBe("conversation-1");
        expect(store.getReference("account-2", "conversation-1")).toBeUndefined();
        db.close();
    });
});
