import { describe, expect, it } from "vitest";
import { isMilkyAction } from "./action-registry.js";

describe("Milky action registry", () => {
    it("注册 1.3 新增与原有标准动作", () => {
        for (const action of [
            "get_peer_pins",
            "set_peer_pin",
            "get_group_announcements",
            "delete_group_announcement",
            "get_group_essence_messages",
            "persist_group_file",
            "send_private_message",
        ]) {
            expect(isMilkyAction(action), action).toBe(true);
        }
        expect(isMilkyAction("not_a_milky_action")).toBe(false);
    });
});
