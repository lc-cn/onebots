import { describe, expect, it } from "vitest";
import { dingtalkSchema } from "./index.js";

describe("钉钉配置 Schema", () => {
    it("按接收模式动态展示回调与 Stream 背压配置", () => {
        const webhookCondition = { path: "receive_mode", oneOf: ["webhook"] };
        const streamCondition = { path: "receive_mode", oneOf: ["stream"] };

        expect(dingtalkSchema.receive_mode.choices).toContainEqual({
            value: "manual",
            label: "手动接入已有连接",
        });
        expect(dingtalkSchema.corp_id.ui?.visibleWhen).toEqual(webhookCondition);
        expect(dingtalkSchema.token.ui?.visibleWhen).toEqual(webhookCondition);
        expect(dingtalkSchema.encrypt_key.ui?.visibleWhen).toEqual(webhookCondition);
        expect(dingtalkSchema.max_pending_event_handlers.ui?.visibleWhen).toEqual(streamCondition);
        expect(dingtalkSchema.max_pending_callback_handlers.ui?.visibleWhen).toEqual(
            streamCondition,
        );
    });
});
