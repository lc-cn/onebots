import type { WechatClient } from "./client.js";
import { defineWechatActionContract } from "./platform-action-contract.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";
import {
    invalid,
    optionalString,
    postRecordAction,
    requireString,
    staticCall,
} from "./platform-action-params.js";

/** 公众号多客服账号与会话管理。 */
export const WECHAT_CUSTOMER_SERVICE_ACTIONS = defineWechatActionContract(
    {
        add_customer_service_account: postRecordAction("/customservice/kfaccount/add", "account"),
        update_customer_service_account: postRecordAction(
            "/customservice/kfaccount/update",
            "account",
        ),
        invite_customer_service_worker: postRecordAction(
            "/customservice/kfaccount/inviteworker",
            "invitation",
        ),
        delete_customer_service_account: queryAction("/customservice/kfaccount/del", "kf_account"),
        upload_customer_service_avatar: uploadCustomerServiceAvatar,
        list_customer_service_accounts: staticCall("/cgi-bin/customservice/getkflist"),
        list_online_customer_service_accounts: staticCall("/cgi-bin/customservice/getonlinekflist"),
        create_customer_service_session: postRecordAction(
            "/customservice/kfsession/create",
            "session",
        ),
        close_customer_service_session: postRecordAction(
            "/customservice/kfsession/close",
            "session",
        ),
        get_customer_service_session: queryAction("/customservice/kfsession/getsession", "openid"),
        list_customer_service_sessions: queryAction(
            "/customservice/kfsession/getsessionlist",
            "kf_account",
        ),
        list_customer_service_waiting_sessions: staticCall("/customservice/kfsession/getwaitcase"),
        get_customer_service_message_records: postRecordAction(
            "/customservice/msgrecord/getmsglist",
            "request",
        ),
    } satisfies Readonly<Record<string, WechatActionHandler>>,
    {
        add_customer_service_account: ["account"],
        update_customer_service_account: ["account"],
        invite_customer_service_worker: ["invitation"],
        delete_customer_service_account: ["kf_account"],
        upload_customer_service_avatar: ["kf_account", "data", "mime_type", "filename"],
        list_customer_service_accounts: [],
        list_online_customer_service_accounts: [],
        create_customer_service_session: ["session"],
        close_customer_service_session: ["session"],
        get_customer_service_session: ["openid"],
        list_customer_service_sessions: ["kf_account"],
        list_customer_service_waiting_sessions: [],
        get_customer_service_message_records: ["request"],
    },
);

function queryAction(path: string, parameter: string): WechatActionHandler {
    return async (client, params) =>
        client.call({ path, query: { [parameter]: requireString(params, parameter) } });
}

async function uploadCustomerServiceAvatar(
    client: WechatClient,
    params: WechatActionParams,
): Promise<unknown> {
    const data = requireString(params, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data)) {
        invalid("客服头像 data 必须是有效 Base64");
    }
    const form = new FormData();
    form.set(
        "media",
        new Blob([Uint8Array.from(Buffer.from(data, "base64"))], {
            type: optionalString(params, "mime_type") || "image/jpeg",
        }),
        optionalString(params, "filename") || "avatar.jpg",
    );
    return client.call({
        method: "POST",
        path: "/customservice/kfaccount/uploadheadimg",
        query: { kf_account: requireString(params, "kf_account") },
        body: form,
    });
}
