import { describe, expect, it } from "vitest";
import { assertAdapterCapabilities, listSupportedActions } from "onebots";
import { teamsCapabilities } from "./capabilities.js";

describe("teamsCapabilities", () => {
    it("声明的原生能力清单满足统一契约", () => {
        expect(() => assertAdapterCapabilities(teamsCapabilities)).not.toThrow();
        expect(listSupportedActions(teamsCapabilities)).toEqual(
            expect.arrayContaining([
                "send_message",
                "update_message",
                "create_personal_conversation",
                "send_adaptive_card",
                "list_conversation_members_paged",
                "send_meeting_notification",
                "call_graph_api",
            ]),
        );
    });
});
