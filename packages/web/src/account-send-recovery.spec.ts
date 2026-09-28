import { describe, expect, it } from "vitest";
import {
    readPendingAccountSends,
    writePendingAccountSends,
    type AccountSendOperationStorage,
} from "./account-send-recovery.js";

function storage(): AccountSendOperationStorage {
    const values = new Map<string, string>();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
    };
}

describe("待确认发送浏览器恢复", () => {
    it("只保存会话键和操作 ID，不保存消息正文", () => {
        const state = storage();
        const key = JSON.stringify(["mock/bot", "friend", "", "user-1"]);
        const id = "00000000-0000-4000-8000-000000000001";
        writePendingAccountSends(state, new Map([[key, id]]));
        expect(readPendingAccountSends(state)).toEqual(new Map([[key, id]]));
        expect(state.getItem("onebots.control.pending-sends.v1")).toBe(JSON.stringify([[key, id]]));
    });

    it("恢复独立 direct 会话的待确认操作，但拒绝其他五段键", () => {
        const state = storage();
        const direct = JSON.stringify(["mock/bot", "friend", "", "room-1", "direct"]);
        const id = "00000000-0000-4000-8000-000000000001";
        writePendingAccountSends(state, new Map([[direct, id]]));
        expect(readPendingAccountSends(state)).toEqual(new Map([[direct, id]]));

        const invalid = JSON.stringify(["mock/bot", "group", "", "room-1", "direct"]);
        writePendingAccountSends(state, new Map([[invalid, id]]));
        expect(readPendingAccountSends(state).size).toBe(0);
    });

    it("丢弃畸形、超限与非操作 UUID，避免污染发送状态", () => {
        const state = storage();
        state.setItem("onebots.control.pending-sends.v1", JSON.stringify([["bad", "not-uuid"]]));
        expect(readPendingAccountSends(state).size).toBe(0);
        state.setItem("onebots.control.pending-sends.v1", "x".repeat(230_001));
        expect(readPendingAccountSends(state).size).toBe(0);
    });
});
