import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { render } from "ink";
import { resolveGatewayBaseUrl } from "./doctor.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import type { ServiceScope } from "./service-manager.js";
import { writeCliOutput } from "./cli-output.js";
/** 根据桥接配置计算 Web 管理端地址。 */
export function getGatewayUrl(configPath: string): string {
    const config = fs.existsSync(configPath)
        ? parseRuntimeConfig(fs.readFileSync(configPath, "utf8"))
        : {};
    return resolveGatewayBaseUrl(config);
}

/** Web 页面固定由本机 origin 提供，HTTP API 前缀由运行时元数据注入。 */
export function getWebUrl(configPath: string): string {
    return new URL(getGatewayUrl(configPath)).origin;
}

/** 使用当前操作系统的默认浏览器打开地址。 */
export async function openWeb(url: string): Promise<void> {
    const command =
        process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "cmd.exe"
              : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}

export async function runUi(options: {
    configPath: string;
    scope: ServiceScope;
    webOnly?: boolean;
}): Promise<void> {
    if (options.webOnly) {
        const url = getWebUrl(options.configPath);
        await openWeb(url);
        writeCliOutput(`已打开 ${url}`);
        return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("onebots ui 需要交互式终端");
    const { OneBotsTui } = await import("./tui/app.js");
    await render(
        <OneBotsTui configPath={options.configPath} system={options.scope === "system"} />,
    ).waitUntilExit();
}
