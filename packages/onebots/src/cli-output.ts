/** CLI 与日志系统初始化前的标准输出边界。 */
export function writeCliOutput(message: string): void {
    process.stdout.write(`${message}\n`);
}

/** CLI 错误及需要用户立即关注的初始化提示。 */
export function writeCliError(message: string): void {
    process.stderr.write(`${message}\n`);
}
