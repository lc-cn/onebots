import { AsyncLocalStorage } from "node:async_hooks";

const outputScope = new AsyncLocalStorage<(message: string) => void>();

/** 交互工作台把同一次操作的 CLI 消息收进活动区，其他命令仍保留原始输出。 */
export function withCliOutput<T>(
    sink: (message: string) => void,
    action: () => Promise<T>,
): Promise<T> {
    return outputScope.run(sink, action);
}

/** CLI 与日志系统初始化前的标准输出边界。 */
export function writeCliOutput(message: string): void {
    const sink = outputScope.getStore();
    if (sink) return sink(message);
    process.stdout.write(`${message}\n`);
}

/** CLI 错误及需要用户立即关注的初始化提示。 */
export function writeCliError(message: string): void {
    const sink = outputScope.getStore();
    if (sink) return sink(message);
    process.stderr.write(`${message}\n`);
}
