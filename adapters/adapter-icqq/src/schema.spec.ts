import { describe, expect, it } from "vitest";
import { icqqSchema } from "./index.js";

describe("ICQQ 配置 Schema", () => {
    it("为 Web 表单提供凭据、传输、过滤和高级分区", () => {
        expect(icqqSchema.password).toMatchObject({
            sensitive: true,
            ui: { section: "credentials" },
        });
        expect(icqqSchema.protocol).toMatchObject({
            sign_api_addr: { ui: { section: "transport" } },
            ignore_self: { ui: { section: "filter" } },
            resend: { ui: { section: "delivery" } },
            log_config: { ui: { section: "advanced" } },
        });
    });
});
