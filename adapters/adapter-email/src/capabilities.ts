import { defineAdapterCapabilities, type AdapterCapabilityManifest } from "onebots";
import { EMAIL_PLATFORM_ACTIONS } from "./platform-actions.js";

const platformActions = Object.fromEntries(
    [...EMAIL_PLATFORM_ACTIONS].map(action => [action, { support: "native" as const }]),
);

/** SMTP、IMAP IDLE、线程头和邮箱管理的真实能力。 */
export const emailCapabilities: AdapterCapabilityManifest = defineAdapterCapabilities({
    actions: {
        send_message: { support: "native", scenes: ["private", "direct"] },
        delete_message: {
            support: "native",
            note: "删除 IMAP 邮箱中的邮件，不等同于撤回已投递邮件",
        },
        get_message: {
            support: "native",
            note: "按 RFC Message-ID 或可逆 IMAP 原生 ID 查询邮箱",
        },
        get_message_history: { support: "native", scenes: ["private", "direct"] },
        mark_message_as_read: { support: "native" },
        get_login_info: { support: "native" },
        get_user_info: { support: "emulated", note: "邮件协议没有用户目录，仅投影邮箱地址" },
        can_send_image: { support: "native" },
        can_send_record: { support: "native", note: "明确返回 false" },
        get_version: { support: "native" },
        get_status: { support: "native" },
        get_supported_actions: { support: "native" },
        ...platformActions,
    },
    events: {
        message: { support: "native", scenes: ["private", "direct"] },
        raw_event: { support: "native" },
    },
    segments: {
        text: { support: "native", direction: "both" },
        image: { support: "native", direction: "both" },
        file: { support: "native", direction: "both" },
        reply: { support: "native", direction: "send" },
        email: { support: "native", direction: "send" },
        email_html: { support: "native", direction: "receive" },
    },
    transports: {
        smtp: { support: "native", mode: "native" },
        imap_idle: { support: "native", mode: "native" },
    },
});
