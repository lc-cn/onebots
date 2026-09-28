import type { Adapter } from "./adapter.js";

/** 所有协议与管理控制页共用的发送 seam；成功后才发布可持久化的发送事实。 */
export async function sendAccountMessage(
    adapter: Adapter,
    accountId: string,
    params: Adapter.SendMessageParams,
): Promise<Adapter.SendMessageResult> {
    const result = await adapter.sendMessage(accountId, params);
    try {
        adapter.emit("message:sent", {
            platform: String(adapter.platform),
            account_id: accountId,
            params,
            result,
        });
    } catch {
        // 历史旁路失败不能让调用方误认为已成功的平台发送未发生。
    }
    return result;
}
