/** 管理 socket 可用不等于启动恢复完成；等待验收场景要求的完整状态。 */
export async function waitForComposeState(
    readStatus,
    expected,
    {
        timeout = 60_000,
        now = () => performance.now(),
        sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    } = {},
) {
    const deadline = now() + timeout;
    let lastError = new Error("测试管理服务未就绪");
    while (true) {
        const remaining = Math.floor(deadline - now());
        if (remaining <= 0) throw lastError;
        try {
            const status = readStatus(Math.min(5_000, remaining));
            if (
                status?.processOwnership?.available === expected.ownership &&
                status?.gateway?.desired === expected.desired &&
                status?.gateway?.actual === expected.actual
            )
                return status;
            lastError = new Error(`管理服务未进入预期状态 ${JSON.stringify(expected)}`);
        } catch (error) {
            lastError = error;
        }
        const delay = Math.min(200, deadline - now());
        if (delay > 0) await sleep(delay);
    }
}
