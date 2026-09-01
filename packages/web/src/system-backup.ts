export type SystemBackupResult =
    | { success: true; message: string }
    | { success: false; message: string };

/** 验证备份回执确实由请求绑定的 OneBots 实例处理。 */
export async function parseSystemBackupResponse(
    response: Response,
    expectedInstanceId: string,
): Promise<SystemBackupResult> {
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) {
        return { success: false, message: `备份响应无效（HTTP ${response.status}）` };
    }
    const message = boundedMessage(payload.message, response.ok ? "已备份到仓库" : "备份请求失败");
    if (!response.ok || payload.success !== true) return { success: false, message };
    if (payload.application !== "onebots") {
        return { success: false, message: "备份回执未声明 onebots 应用身份" };
    }
    if (payload.instance_id !== expectedInstanceId) {
        return {
            success: false,
            message: `备份回执实例不匹配：期望 ${expectedInstanceId}，实际 ${typeof payload.instance_id === "string" ? payload.instance_id : "缺失"}`,
        };
    }
    return { success: true, message };
}

function boundedMessage(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim()
        ? value.trim().replaceAll(/\s+/g, " ").slice(0, 500)
        : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
