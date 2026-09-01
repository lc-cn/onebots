import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { ServiceSpec } from "./service-manager.js";
import {
    inspectServiceNodeRuntime,
    type DoctorServiceRuntimeInspection,
} from "./doctor-service-runtime.js";
import { inspectServiceEntry, type DoctorServiceEntryInspection } from "./doctor-service-entry.js";
import { hasManagementCredentials } from "./management-credentials.js";
import { pluginCandidates, tryLoadRegisteredPlugin, type PluginType } from "./plugin-loader.js";
import { parseRuntimeConfig, validateRuntimeConfig } from "./runtime-config-validator.js";

export type ServicePreflightSpec = Pick<
    ServiceSpec,
    "configPath" | "adapters" | "protocols" | "workingDirectory"
>;

const execFileAsync = promisify(execFile);

interface IsolatedPreflightExecutionOptions {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
}

export type IsolatedPreflightExecutor = (
    file: string,
    args: string[],
    options: IsolatedPreflightExecutionOptions,
) => Promise<unknown>;

export interface IsolatedPreflightProcessOptions {
    nodePath?: string;
    binPath?: string;
    timeoutMs?: number;
    execute?: IsolatedPreflightExecutor;
}

const executeIsolatedPreflight: IsolatedPreflightExecutor = async (file, args, options) => {
    await execFileAsync(file, args, options);
};

/**
 * 在一次性 CLI 进程中执行与守护服务相同的预检。
 * 插件导入和 Registry 写入不会污染仍在提供管理端的在线进程。
 */
export async function preflightServiceRuntimeIsolated(
    spec: ServicePreflightSpec,
    options: IsolatedPreflightProcessOptions = {},
): Promise<void> {
    const nodePath = options.nodePath ?? process.execPath;
    const binPath = options.binPath ?? process.argv[1];
    if (!binPath) throw new Error("无法确定 OneBots CLI 入口，不能执行隔离重启预检");
    const args = [
        path.resolve(binPath),
        "--service-runtime",
        "preflight",
        "-c",
        spec.configPath,
        ...spec.adapters.flatMap(adapter => ["-r", adapter]),
        ...spec.protocols.flatMap(protocol => ["-p", protocol]),
    ];
    try {
        await (options.execute ?? executeIsolatedPreflight)(nodePath, args, {
            cwd: spec.workingDirectory,
            env: { ...process.env, ONEBOTS_HEADLESS_CHILD: "1" },
            timeout: options.timeoutMs ?? 60_000,
            maxBuffer: 4 * 1024 * 1024,
        });
    } catch (error) {
        throw new Error(isolatedPreflightErrorMessage(error), {
            cause: error instanceof Error ? error : undefined,
        });
    }
}

export interface InstalledServiceRuntimePreflightDependencies {
    inspectNode(nodePath: string): DoctorServiceRuntimeInspection;
    inspectEntry(binPath: string): DoctorServiceEntryInspection;
    runIsolated(
        spec: ServicePreflightSpec,
        options: IsolatedPreflightProcessOptions,
    ): Promise<void>;
}

const installedRuntimePreflightDependencies: InstalledServiceRuntimePreflightDependencies = {
    inspectNode: inspectServiceNodeRuntime,
    inspectEntry: inspectServiceEntry,
    runIsolated: preflightServiceRuntimeIsolated,
};

/** 使用服务定义保存的 Node 与 OneBots 入口执行预检，不借用当前 CLI 进程的运行时。 */
export async function preflightInstalledServiceRuntime(
    spec: ServiceSpec,
    dependencies: InstalledServiceRuntimePreflightDependencies = installedRuntimePreflightDependencies,
): Promise<void> {
    const runtime = dependencies.inspectNode(spec.nodePath);
    if (!runtime.supported) throw new Error(runtime.check.message);

    const entry = dependencies.inspectEntry(spec.binPath);
    if (!entry.valid) throw new Error(entry.check.message);

    await dependencies.runIsolated(spec, {
        nodePath: spec.nodePath,
        binPath: spec.binPath,
    });
}

/** 按守护进程实际工作目录加载插件并校验配置，但不连接平台或写入服务定义。 */
export async function preflightServiceRuntime(spec: ServicePreflightSpec): Promise<void> {
    if (!fs.existsSync(spec.workingDirectory)) {
        throw new Error(`服务工作目录不存在: ${spec.workingDirectory}`);
    }
    if (!fs.existsSync(spec.configPath)) {
        throw new Error(`配置文件不存在: ${spec.configPath}`);
    }

    const runtimeRequire = createRequire(path.join(spec.workingDirectory, "package.json"));
    const failures: string[] = [];
    for (const [type, names] of [
        ["adapter", spec.adapters],
        ["protocol", spec.protocols],
    ] as const satisfies ReadonlyArray<readonly [PluginType, readonly string[]]>) {
        for (const name of names) {
            const result = await tryLoadRegisteredPlugin(
                type,
                name,
                pluginCandidates(type, name),
                runtimeRequire,
            );
            if (result.loaded === false) failures.push(result.message);
        }
    }
    if (failures.length > 0) {
        throw new Error(`插件加载失败：${failures.join("；")}`);
    }

    const config = parseRuntimeConfig(fs.readFileSync(spec.configPath, "utf8"));
    validateRuntimeConfig(config);
    if (!hasManagementCredentials(config, "")) {
        throw new Error(
            "服务配置缺少持久化管理凭据。守护服务不会保存当前 shell 的 ONEBOTS_ACCESS_TOKEN；请将 access_token 或完整用户名密码写入配置，也可取消该环境变量后执行 onebots setup --force 自动生成鉴权码",
        );
    }
}

function isolatedPreflightErrorMessage(error: unknown): string {
    const stderr =
        error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
            ? error.stderr
            : "";
    const diagnostic = stderr
        .split(/\r?\n/u)
        .map(line => line.trim())
        .filter(Boolean)
        .at(-1)
        ?.replace(/^\[onebots\]\s*/u, "");
    if (diagnostic) return diagnostic;
    return error instanceof Error ? error.message : String(error);
}
