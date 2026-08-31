import { describe, expect, it } from "vitest";
import { weComCapabilities } from "./capabilities.js";

describe("weComCapabilities", () => {
    it("部门不再投影群聊，appchat 保留真实群语义", () => {
        expect(weComCapabilities.actions.get_group_list).toBeUndefined();
        expect(weComCapabilities.actions.get_group_info?.support).toBe("native");
        expect(weComCapabilities.actions.send_message?.scenes).toContain("group");
        expect(weComCapabilities.actions.recall_message?.support).toBe("native");
    });
});
