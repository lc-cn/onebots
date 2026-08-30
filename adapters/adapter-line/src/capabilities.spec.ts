import { describe, expect, it } from "vitest";
import { lineCapabilities } from "./capabilities.js";
import { LINE_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("LINE 能力清单", () => {
    it("所有平台动作均公开且不存在虚假的删除能力", () => {
        for (const action of LINE_PLATFORM_ACTIONS) {
            expect(lineCapabilities.actions[action]?.support).toBe("native");
        }
        expect(
            [...LINE_PLATFORM_ACTIONS].filter(action => !lineCapabilities.actions[action]),
        ).toEqual([]);
        expect(lineCapabilities.actions.delete_message?.support).toBe("unsupported");
        expect(LINE_PLATFORM_ACTIONS.has("leave_group")).toBe(false);
        expect(lineCapabilities.actions.leave_group?.support).toBe("native");
        expect(lineCapabilities.actions.mark_message_as_read?.support).toBe("native");
        expect(lineCapabilities.segments.line_message?.support).toBe("native");
        expect(lineCapabilities.events.group_increase?.support).toBe("native");
        expect(lineCapabilities.events.group_decrease?.support).toBe("native");
        expect(lineCapabilities.events.user_updated?.support).toBe("native");
        expect(lineCapabilities.events.message_status?.support).toBe("native");
    });
});
