import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalControlClient } from "../client/local-control.js";
import { startControlHost } from "./host.js";
import { writeCliOutput } from "../cli-output.js";

/** 新控制入口只在独立架构分支启用，所有启停调用同一客户端。 */
export async function runControlCommand(argv: string[]): Promise<boolean> {
    const command = argv[2];
    if (!["serve", "auth", "control"].includes(command)) return false;
    const options = argv.slice(3);
    function option(name: string, fallback: string): string {
        const index = options.indexOf(name);
        if (index < 0) return fallback;
        const value = options[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`${name} 需要参数`);
        return value;
    }
    const workspace = path.resolve(
        option("--data-dir", process.env.ONEBOTS_WORKSPACE ?? process.cwd()),
    );
    if (command === "serve") {
        const port = Number(option("--port", process.env.PORT ?? "6727"));
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("管理端口无效");
        const host = await startControlHost({
            workspace,
            port,
            host: option("--host", "127.0.0.1"),
        });
        writeCliOutput(
            `[onebots] 管理服务已启动；首次配对请运行 onebots auth bootstrap --data-dir ${workspace}`,
        );
        let stopping = false;
        for (const signal of ["SIGINT", "SIGTERM"] as const)
            process.once(signal, () => {
                if (stopping) return;
                stopping = true;
                void host.close().then(
                    () => {
                        process.exitCode = 0;
                    },
                    () => {
                        process.exitCode = 1;
                    },
                );
            });
        return true;
    }
    const client = createLocalControlClient(workspace);
    const action = options[0];
    if (command === "auth") {
        if (action !== "bootstrap") throw new Error("使用 onebots auth bootstrap 获取单次配对码");
        const result = await client.bootstrap();
        writeCliOutput(result.code);
        return true;
    }
    if (action === "status") writeCliOutput(JSON.stringify(await client.status()));
    else if (action === "plan") {
        const names = (name: string) =>
            option(name, "")
                .split(",")
                .map(value => value.trim())
                .filter(Boolean);
        const catalog = await client.installationCatalog();
        writeCliOutput(
            JSON.stringify(
                await client.planInstallation(
                    {
                        adapters: names("--adapters"),
                        protocols: names("--protocols"),
                        applications: names("--frameworks"),
                    },
                    catalog.activeGenerationId,
                ),
            ),
        );
    } else if (action === "install") {
        const token = options.includes("--auth-stdin") ? await readDownloadToken() : undefined;
        writeCliOutput(
            JSON.stringify(
                await client.install({
                    id: option("--request", randomUUID()),
                    planId: option("--plan", ""),
                    ...(token ? { token } : {}),
                }),
            ),
        );
    } else if (action === "installation") {
        writeCliOutput(JSON.stringify(await client.installation(option("--request", ""))));
    } else if (action === "cancel-installation") {
        writeCliOutput(JSON.stringify(await client.cancelInstallation(option("--request", ""))));
    } else if (action === "activate") {
        const operation = await client.activateGeneration(option("--generation", ""));
        writeCliOutput(JSON.stringify(operation));
        if (operation.status === "failed") process.exitCode = 1;
    } else if (action === "start" || action === "stop" || action === "restart") {
        const operation = await client.gateway(action);
        writeCliOutput(JSON.stringify(operation));
        if (operation.status === "failed") process.exitCode = 1;
    } else
        throw new Error(
            "控制命令应为 status、start、stop、restart、plan、install、installation、cancel-installation 或 activate",
        );
    return true;
}

async function readDownloadToken(): Promise<string> {
    if (process.stdin.isTTY)
        throw new Error("--auth-stdin 仅接受安全管道输入，不能在终端明文输入授权");
    let input = "";
    for await (const chunk of process.stdin) {
        input += chunk.toString();
        if (Buffer.byteLength(input) > 512) throw new Error("下载授权格式无效");
    }
    const token = input.trim();
    if (!/^[A-Za-z0-9_]+$/.test(token)) throw new Error("下载授权格式无效");
    return token;
}
