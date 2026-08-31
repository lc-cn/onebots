import { describe, expect, it } from "vitest";
import { describeMatrixCapabilities, matrixCapabilities } from "./capabilities.js";
import { MATRIX_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Matrix 能力清单", () => {
    it("平台动作完全由可执行注册表驱动", () => {
        expect(
            [...MATRIX_PLATFORM_ACTIONS].filter(action => !matrixCapabilities.actions[action]),
        ).toEqual([]);
        for (const action of MATRIX_PLATFORM_ACTIONS) {
            expect(matrixCapabilities.actions[action]?.support).toBe("native");
        }
        expect(matrixCapabilities.transports).toMatchObject({
            sync: { support: "native", mode: "polling" },
            appservice: { support: "native", mode: "webhook" },
            manual: { support: "native", mode: "native" },
        });
    });

    it("sync event_types 精确收窄账号事件能力", () => {
        const restricted = describeMatrixCapabilities({
            receive_mode: "sync",
            event_types: ["m.room.message"],
        });
        expect(restricted.events.message?.support).toBe("native");
        expect(restricted.events.message_updated?.support).toBe("native");
        expect(restricted.events.reaction_added?.support).toBe("unsupported");
        expect(restricted.events.member_joined?.support).toBe("unsupported");
        expect(restricted.events.custom?.support).toBe("unsupported");
    });

    it("appservice/manual 不根据本地配置虚构 homeserver 订阅范围", () => {
        expect(describeMatrixCapabilities({ receive_mode: "appservice", event_types: [] })).toBe(
            matrixCapabilities,
        );
        expect(describeMatrixCapabilities({ receive_mode: "manual", event_types: [] })).toBe(
            matrixCapabilities,
        );
        expect(matrixCapabilities.events.custom?.note).toContain("不伪装 E2EE 解密");
    });
});
