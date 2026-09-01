export type BotLifecycleActionResult =
    | { success: true }
    | { success: false; code?: string; message: string };

/** 从管理 API 保留稳定错误证据，同时限制不可信响应进入界面的大小。 */
export async function parseBotLifecycleActionResponse(
    response: Response,
    fallback: string,
): Promise<BotLifecycleActionResult> {
    if (response.ok) return { success: true };
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { success: false, message: `${fallback}（HTTP ${response.status}）` };
    }
    const record = payload as Record<string, unknown>;
    const message =
        typeof record.message === "string" && record.message.trim()
            ? record.message.trim().replace(/\s+/gu, " ").slice(0, 500)
            : `${fallback}（HTTP ${response.status}）`;
    const code =
        typeof record.code === "string" && record.code.trim()
            ? record.code.trim().slice(0, 100)
            : undefined;
    return code ? { success: false, code, message } : { success: false, message };
}
