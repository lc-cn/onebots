import { describe, expect, it } from "vitest";
import { resolveFeishuBotId } from "./identity.js";

describe("resolveFeishuBotId", () => {
    it("优先使用飞书 open_id，并以 app_id 作为初始化回退", () => {
        expect(resolveFeishuBotId({ open_id: "ou_bot", user_id: "user_bot" }, "cli_app")).toBe(
            "ou_bot",
        );
        expect(resolveFeishuBotId(null, "cli_app")).toBe("cli_app");
    });
});
