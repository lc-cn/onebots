/** 有界重试公开 CLI；每次调用都获得剩余预算，超时保留最后的脱敏失败原因。 */
export async function waitForCLIStatus(
    readStatus,
    {
        timeout = 30_000,
        now = Date.now,
        sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    } = {},
) {
    const deadline = now() + timeout;
    let lastError = new Error("管理服务 CLI 未在期限内就绪");
    while (true) {
        const budget = deadline - now();
        if (budget <= 0) throw lastError;
        try {
            const status = readStatus(Math.min(1_000, budget));
            if (!status || typeof status !== "object" || Array.isArray(status))
                throw new Error("管理服务 CLI 返回无效状态");
            return status;
        } catch (error) {
            lastError = error;
        }
        const remaining = deadline - now();
        if (remaining > 0) await sleep(Math.min(100, remaining));
    }
}
