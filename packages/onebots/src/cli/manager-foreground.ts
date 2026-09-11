import { runControlCommand } from "../control/command.js";

/** 公开 run 是 serve 的别名，共用参数解析、监听与信号关闭；旧托管入口另由 CLI 明确分流。 */
export async function runManagerForeground(args: string[]): Promise<void> {
    if (
        args.some(argument =>
            /^(?:-[crpt](?:.*)?|--(?:config|register|protocol|target)(?:=.*)?)$/.test(argument),
        )
    )
        throw new Error(
            "run 不再接受 -c/-r/-p/-t。请用 --data-dir 指定工作区，通过 TUI/Web 安装扩展和配置账号；旧系统服务请先执行 onebots migrate。",
        );
    await runControlCommand([process.execPath, process.argv[1], "serve", ...args]);
}
