import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type {
    ConfigurationVerification,
    ConfigurationVerificationInput,
} from "./configuration-verify.js";

const directory = process.argv[2];
if (!process.send || !directory) process.exit(1);
function clearRequest(): void {
    // 子进程只清理自己的敏感请求；owner.json 必须保留到父进程证明整组退出。
    // 父进程崩溃或回收不明时，冷恢复仍需读取该记录，不能由 worker 提前删除目录。
    fs.rmSync(path.join(directory, "request.json"), { force: true });
}
function stop(): void {
    try {
        clearRequest();
    } finally {
        try {
            process.kill(-process.pid, "SIGKILL");
        } finally {
            process.exit(1);
        }
    }
}
process.once("disconnect", stop);
process.once("SIGTERM", stop);
async function verify(): Promise<ConfigurationVerification> {
    const input: ConfigurationVerificationInput = JSON.parse(
        fs.readFileSync(path.join(directory, "request.json"), "utf8"),
    );
    const require = createRequire(path.join(input.runtimeRoot, "package.json"));
    const hostEntry = input.hostEntrypoint ?? require.resolve("onebots");
    const hostDirectory = path.dirname(hostEntry);
    // 宿主内置应用注册必须先完成，不能误判为随后加载的适配器越权注册。
    await import(pathToFileURL(hostEntry).href);
    const loader = await import(pathToFileURL(path.join(hostDirectory, "plugin-loader.js")).href);
    for (const [kind, names] of [
        ["adapter", input.selection.adapters],
        ["protocol", input.selection.protocols],
        ["application", input.selection.applications],
    ] as const)
        for (const name of names) {
            const loaded = await loader.tryLoadRegisteredPlugin(
                kind,
                name,
                loader.pluginCandidates(kind, name),
                require,
            );
            if (!loaded.loaded) throw new Error("load");
        }
    const validator = await import(
        pathToFileURL(path.join(hostDirectory, "runtime-config-validator.js")).href
    );
    const config = input.document;
    const paths = new Map<string, string[]>();
    const values: string[] = [];
    function index(value: unknown, original: string, segments: string[], depth: number): void {
        paths.set(original, paths.has(original) ? [] : segments);
        if (typeof value === "string" && value.length > 0) values.push(value);
        if (depth >= 30 || !value || typeof value !== "object") return;
        Object.entries(value).forEach(([key, child]) => {
            index(child, original ? `${original}.${key}` : key, [...segments, key], depth + 1);
        });
    }
    index(config, "", [], 0);
    function safePath(original: unknown): string[] {
        const segments = paths.get(typeof original === "string" ? original : "") ?? [];
        return segments.some(
            segment => segment.length > 1024 || values.some(value => segment.includes(value)),
        )
            ? []
            : segments;
    }
    try {
        validator.validateRuntimeConfig(config);
        return { valid: true, issues: [] };
    } catch (error) {
        const entries = (error as { context?: { issues?: unknown } })?.context?.issues;
        const issues = Array.isArray(entries)
            ? entries.slice(0, 100).map(issue => ({
                  path: safePath(issue?.path),
                  message: "配置字段无效",
              }))
            : [{ path: [], message: "配置字段无效" }];
        return {
            valid: false,
            issues: issues.length ? issues : [{ path: [], message: "配置字段无效" }],
        };
    }
}
process.once("message", async (message: unknown) => {
    try {
        if (
            !message ||
            typeof message !== "object" ||
            !("type" in message) ||
            message.type !== "start"
        )
            throw new Error();
        const result = await verify();
        clearRequest();
        process.send?.(result, () => process.exit(0));
    } catch {
        // 配置、插件异常和日志全部留在私有进程，不能发送原始错误。
        try {
            clearRequest();
        } finally {
            process.exit(1);
        }
    }
});
if (!process.connected) stop();
