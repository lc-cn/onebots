import { listSupportedActions } from "onebots";
import { describe, expect, it } from "vitest";
import { EmailAdapter } from "./adapter.js";
import { emailCapabilities } from "./capabilities.js";
import { EMAIL_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("邮件能力清单", () => {
    it("所有平台动作均显式公开", () => {
        for (const action of EMAIL_PLATFORM_ACTIONS) {
            expect(emailCapabilities.actions[action]?.support, action).toBe("native");
        }
    });

    it("能力清单中的动作都有真实入口", () => {
        for (const action of listSupportedActions(emailCapabilities)) {
            expect(EmailAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });

    it("准确声明 SMTP 与 IMAP IDLE", () => {
        expect(emailCapabilities.transports.smtp).toMatchObject({
            support: "native",
            mode: "native",
        });
        expect(emailCapabilities.transports.imap_idle).toMatchObject({
            support: "native",
            mode: "native",
        });
        expect(emailCapabilities.transports.manual).toMatchObject({
            support: "native",
            mode: "native",
        });
        expect(emailCapabilities.actions.search_emails?.availability).toBe("context");
        expect(emailCapabilities.segments.email_html?.direction).toBe("receive");
    });
});
