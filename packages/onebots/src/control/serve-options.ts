import path from "node:path";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";

export const SERVE_HELP = `onebots serve [--data-dir 工作区] [--host 监听地址] [--port 管理端口]
启动常驻管理服务，网关由控制客户端独立管理。
默认工作区为当前目录，监听 127.0.0.1:6727。
平台、协议和框架通过安装及配置界面选择，不接受 -r/-p/-t。
首次连接：onebots auth bootstrap --data-dir <工作区>`;

export function parseServeOptions(args: string[], env = process.env) {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) return null;
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (
            !["--data-dir", "--host", "--port", "--windows-host-pipe"].includes(name) ||
            values.has(name)
        )
            throw new Error("serve 参数无效或重复，请运行 onebots serve --help");
        if (!value || value.startsWith("-") || /[\0\r\n]/.test(value))
            throw new Error(`${name} 需要有效参数`);
        values.set(name, value);
    }
    const rawPort = values.get("--port") ?? env.PORT ?? "6727";
    const port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("管理端口无效");
    const windowsHostPipe = values.get("--windows-host-pipe");
    if (windowsHostPipe !== undefined && windowsHostPipe !== WINDOWS_HOST_PIPE_NAME)
        throw new Error("Windows 原生宿主管道无效");
    return {
        workspace: path.resolve(values.get("--data-dir") ?? env.ONEBOTS_WORKSPACE ?? process.cwd()),
        host: values.get("--host") ?? "127.0.0.1",
        port,
        ...(windowsHostPipe ? { windowsHostPipe } : {}),
    };
}
