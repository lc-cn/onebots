import { describe, expect, it } from "vitest";
import { wechatCapabilities } from "./capabilities.js";

describe("wechatCapabilities", () => {
    it("只声明真实私聊并公开原生管理动作", () => {
        expect(wechatCapabilities.actions.send_message?.scenes).toEqual(["private"]);
        expect(wechatCapabilities.actions.get_group_list).toBeUndefined();
        expect(wechatCapabilities.actions.wechat_call?.support).toBe("native");
        expect(wechatCapabilities.events.raw_event?.support).toBe("native");
    });
});
