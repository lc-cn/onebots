import * as fs from "node:fs";
import * as path from "node:path";

export type PluginInspection =
    | { status: "ready"; candidate: string; entryPath: string }
    | { status: "broken"; candidate: string; reason: string; buildCommand?: string }
    | { status: "missing"; candidates: string[] };

/** 区分插件未安装与 workspace 包存在但构建入口缺失。 */
export function inspectPlugin(candidates: string[], runtimeRequire: NodeJS.Require): PluginInspection {
    for (const candidate of candidates) {
        try {
            return { status: "ready", candidate, entryPath: runtimeRequire.resolve(candidate) };
        } catch (resolveError) {
            const packageJsonPath = resolvePackageJson(candidate, runtimeRequire);
            if (!packageJsonPath) continue;
            const packageJson = readPackageJson(packageJsonPath);
            const main = typeof packageJson.main === "string" ? packageJson.main : "index.js";
            const entryPath = path.resolve(path.dirname(packageJsonPath), main);
            const reason = fs.existsSync(entryPath)
                ? firstLine(resolveError)
                : `构建产物不存在: ${entryPath}`;
            return {
                status: "broken",
                candidate,
                reason,
                buildCommand: candidate.startsWith("@onebots/") ? `pnpm --filter ${candidate} build` : undefined,
            };
        }
    }
    return { status: "missing", candidates };
}

/** 加载第一个可用插件，并且每个逻辑插件最多输出一条诊断。 */
export function loadPlugin(
    kind: "适配器" | "协议",
    name: string,
    candidates: string[],
    runtimeRequire: NodeJS.Require,
    warn: (message: string) => void = console.warn,
): boolean {
    const inspection = inspectPlugin(candidates, runtimeRequire);
    if (inspection.status === "missing") {
        warn(`[onebots] 未找到${kind} ${name}（已尝试: ${inspection.candidates.join(", ")}）`);
        return false;
    }
    if (inspection.status === "broken") {
        const suggestion = inspection.buildCommand ? `；请先运行 ${inspection.buildCommand}` : "";
        warn(`[onebots] 加载${kind} ${name} 失败：已找到 ${inspection.candidate}，但入口无法加载（${inspection.reason}）${suggestion}`);
        return false;
    }
    try {
        runtimeRequire(inspection.candidate);
        return true;
    } catch (error) {
        warn(`[onebots] 加载${kind} ${name} 失败：${inspection.candidate} 运行时初始化失败（${firstLine(error)}）`);
        return false;
    }
}

function resolvePackageJson(candidate: string, runtimeRequire: NodeJS.Require): string | undefined {
    try {
        return runtimeRequire.resolve(`${candidate}/package.json`);
    } catch {
        return undefined;
    }
}

function readPackageJson(file: string): { main?: unknown } {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as { main?: unknown };
    } catch {
        return {};
    }
}

function firstLine(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}
