import * as path from "node:path";
import { App, createOnebots } from "./app.js";

export interface RuntimeOptions {
    configPath: string;
    adapters: string[];
    protocols: string[];
}

/** 将未知 rejection/异常格式化为可读字符串 */
function formatProcessError(reason: unknown): string {
    if (reason instanceof Error) {
        const name = reason.name || "Error";
        const code = (reason as Error & { code?: string | number }).code;
        const extra = code != null ? ` code=${code}` : "";
        return `${name}: ${reason.message}${extra}`;
    }
    if (reason && typeof reason === "object") {
        const obj = reason as { name?: string; message?: string; code?: string | number };
        if (obj.message) {
            const name = obj.name || "Error";
            const extra = obj.code != null ? ` code=${obj.code}` : "";
            return `${name}: ${obj.message}${extra}`;
        }
    }
    return String(reason);
}

/** 加载命令指定的 adapter 与 protocol，并返回失败项。 */
export async function loadPlugins(adapters: string[], protocols: string[]): Promise<string[]> {
    const failures: string[] = [];
    for (const adapter of adapters) {
        if (!await App.loadAdapterFactory(adapter)) failures.push(`adapter:${adapter}`);
    }
    for (const protocol of protocols) {
        if (!await App.loadProtocolFactory(protocol)) failures.push(`protocol:${protocol}`);
    }
    return failures;
}

/** 以前台模式运行桥接服务，并统一处理优雅关闭。 */
export async function runBridge(options: RuntimeOptions): Promise<void> {
    const configPath = path.resolve(options.configPath);
    const failures = await loadPlugins(options.adapters, options.protocols);
    if (failures.length) {
        throw new Error(`无法加载插件: ${failures.join(", ")}`);
    }

    const app = createOnebots(configPath);
    let shuttingDown = false;

    // 第三方 SDK（如 icqq SSO 心跳）可能抛出未处理的 Promise rejection；注册监听后 Node 不会再默认退出
    const onUnhandledRejection = (reason: unknown) => {
        if (shuttingDown) return;
        app.enhancedLogger.error("未处理的 Promise rejection（已拦截，进程继续运行）", {
            error: formatProcessError(reason),
        });
    };
    process.on("unhandledRejection", onUnhandledRejection);

    const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        process.off("unhandledRejection", onUnhandledRejection);
        const forceTimer = setTimeout(() => {
            app.enhancedLogger.fatal("优雅关闭超过 30 秒，强制退出");
            process.exit(1);
        }, 30_000);
        forceTimer.unref();
        try {
            await app.stop();
            clearTimeout(forceTimer);
            process.exitCode = 0;
        } catch (error) {
            clearTimeout(forceTimer);
            app.enhancedLogger.error(`${signal} 关闭失败`, { error });
            process.exitCode = 1;
        }
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    try {
        await app.start();
    } catch (error) {
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
        process.off("unhandledRejection", onUnhandledRejection);
        throw error;
    }
}
