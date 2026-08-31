import { describe, expect, it } from "vitest";
import { resolveCapabilityStatus } from "../../scripts/protocol-api-capability-map.mjs";

describe("协议 API 能力场景映射", () => {
    const manifest = {
        actions: {
            send_message: { support: "native", scenes: ["direct"] },
            upload_file: { support: "emulated", scenes: ["group"] },
        },
    };

    it("同一 canonical 动作按 direct/group 场景分别判定", () => {
        expect(
            resolveCapabilityStatus(manifest, { action: "send_message", scene: "direct" }),
        ).toBe("native");
        expect(
            resolveCapabilityStatus(manifest, { action: "send_message", scene: "group" }),
        ).toBe("unsupported");
        expect(
            resolveCapabilityStatus(manifest, { action: "upload_file", scene: "group" }),
        ).toBe("emulated");
    });

    it("未声明 scenes 的通用动作保持原有能力语义", () => {
        expect(
            resolveCapabilityStatus(
                { actions: { send_message: { support: "native" } } },
                { action: "send_message", scene: "group" },
            ),
        ).toBe("native");
    });
});
