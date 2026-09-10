import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createGenerationPlan, type GenerationPlan } from "../installation/generation-plan.js";
import { allocateConfigurationVerification } from "../configuration/configuration-verify-ownership.js";
import { runOwnedWorker } from "./owned-worker.js";
import { createDefaultServiceHost } from "../service-host.js";
import { secureWindowsServiceDirectory } from "../windows-service-security.js";
import { verifyGeneration } from "../installation/generation-verify.js";
import type { GenerationVerification } from "../installation/generation-store.js";

export interface ManagerCandidateVerification {
    schemaVersion: 1;
    planDigest: string;
    hostVersion: string;
    coreVersion: string;
    nodeAbi: string;
    platform: string;
    arch: string;
    checks: {
        managementStartup: true;
        webAssets: true;
        anonymousDenied: true;
        authenticationV2: true;
        maintenance: true;
        closed: true;
    };
}

export interface ManagerCandidateInstallationVerification {
    dependencies: GenerationVerification;
    management: ManagerCandidateVerification;
}

/** POSIX 保持两段既有验证；Windows 在同一个 native Job Object worker 内完成全部门槛。 */
export async function verifyManagerCandidateInstallation(
    directory: string,
    plan: GenerationPlan,
    options: {
        privateRoot: string;
        signal?: AbortSignal;
        timeoutMs?: number;
    },
): Promise<ManagerCandidateInstallationVerification> {
    if (process.platform === "win32")
        return verifyWindowsManagerCandidate(directory, plan, options);
    const dependencies = await verifyGeneration(directory, plan, options);
    const management = await verifyManagerCandidate(directory, plan, options);
    return { dependencies, management };
}

/** 仅验证独立管理程序候选；不接收业务配置、平台选择或下载凭据。 */
export async function verifyManagerCandidate(
    directory: string,
    plan: GenerationPlan,
    options: {
        privateRoot: string;
        signal?: AbortSignal;
        timeoutMs?: number;
    },
): Promise<ManagerCandidateVerification> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const canonical = createGenerationPlan({
        ...plan,
        target: { platform: plan.platform, arch: plan.arch, nodeAbi: plan.nodeAbi },
    });
    if (
        canonical.digest !== plan.digest ||
        plan.platform !== process.platform ||
        plan.arch !== process.arch ||
        plan.nodeAbi !== process.versions.modules ||
        plan.extensions.length ||
        [plan.selection.adapters, plan.selection.protocols, plan.selection.applications].some(
            items => items.length,
        ) ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 300_000 ||
        options.signal?.aborted
    )
        throw new Error("管理程序候选计划或验证环境无效");
    const root = fs.realpathSync(directory);
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("管理程序候选目录无效");
    const expected: ManagerCandidateVerification = {
        schemaVersion: 1,
        planDigest: plan.digest,
        hostVersion: plan.host.version,
        coreVersion: plan.core.version,
        nodeAbi: plan.nodeAbi,
        platform: plan.platform,
        arch: plan.arch,
        checks: {
            managementStartup: true,
            webAssets: true,
            anonymousDenied: true,
            authenticationV2: true,
            maintenance: true,
            closed: true,
        },
    };
    if (process.platform === "win32")
        return (await verifyWindowsManagerCandidate(directory, plan, options)).management;
    const allocation = allocateConfigurationVerification(options.privateRoot);
    const lifecycle = { cleanupAllowed: true };
    try {
        const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
        return await runOwnedWorker({
            entrypoint: fileURLToPath(
                new URL(`./manager-candidate-worker.${extension}`, import.meta.url),
            ),
            cwd: root,
            directory: allocation.directory,
            owner: allocation.owner,
            request: {
                root,
                workspace: path.join(fs.realpathSync(allocation.directory), "workspace"),
                expected,
            },
            timeoutMs,
            signal: options.signal,
            lifecycle,
            decode(value) {
                if (JSON.stringify(value) !== JSON.stringify(expected))
                    throw new Error("管理程序候选验证未完成");
                return expected;
            },
        });
    } finally {
        if (lifecycle.cleanupAllowed)
            fs.rmSync(allocation.directory, { recursive: true, force: true });
    }
}

/** Windows 验证 worker 始终由当前可信 native host 的 Job Object 承载。 */
function verifyWindowsManagerCandidate(
    directory: string,
    plan: GenerationPlan,
    options: { privateRoot: string; signal?: AbortSignal; timeoutMs?: number },
): ManagerCandidateInstallationVerification {
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
        throw new Error("管理程序候选计划或验证环境无效");
    options.signal?.throwIfAborted();
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("管理程序候选目录无效");
    const root = fs.realpathSync(directory);
    if (fs.existsSync(path.join(root, "receipt.json")))
        throw new Error("不能重新验证已提交运行版本");
    const canonical = createGenerationPlan({
        ...plan,
        target: { platform: plan.platform, arch: plan.arch, nodeAbi: plan.nodeAbi },
    });
    if (
        canonical.digest !== plan.digest ||
        plan.platform !== process.platform ||
        plan.arch !== process.arch ||
        plan.nodeAbi !== process.versions.modules
    )
        throw new Error("管理程序候选计划或验证环境无效");
    const expected: ManagerCandidateVerification = {
        schemaVersion: 1,
        planDigest: plan.digest,
        hostVersion: plan.host.version,
        coreVersion: plan.core.version,
        nodeAbi: plan.nodeAbi,
        platform: plan.platform,
        arch: plan.arch,
        checks: {
            managementStartup: true,
            webAssets: true,
            anonymousDenied: true,
            authenticationV2: true,
            maintenance: true,
            closed: true,
        },
    };
    const host = createDefaultServiceHost();
    const id = randomUUID();
    const allocation = path.join(path.resolve(options.privateRoot), `windows-${id}`);
    const worker = fileURLToPath(new URL("./manager-candidate-worker.js", import.meta.url));
    const nativeHost = path.resolve(
        import.meta.dirname,
        "..",
        "native",
        `win32-${process.arch}`,
        "onebots-windows-host.exe",
    );
    const request = path.join(allocation, "request.json");
    const result = path.join(allocation, "result.json");
    let cleanup = false;
    let parentFailure:
        | "native-timeout"
        | "native-error"
        | "native-signal"
        | "native-exit"
        | "result-missing"
        | "result-invalid"
        | "worker-failed" = "native-error";
    try {
        secureWindowsServiceDirectory(host, allocation);
        fs.writeFileSync(
            request,
            JSON.stringify({ root, workspace: path.join(allocation, "workspace"), plan, expected }),
            { flag: "wx", mode: 0o600 },
        );
        if (!fs.statSync(nativeHost).isFile() || fs.statSync(nativeHost).size < 100_000)
            throw new Error();
        const execution = spawnSync(
            nativeHost,
            windowsManagerCandidateHostArguments({
                id,
                root,
                worker,
                request,
                result,
                sid: host.windowsSid!,
            }),
            { stdio: "ignore", timeout: timeoutMs, windowsHide: true },
        );
        // console-run 将候选 worker 的正常退出视为 manager 离开并返回 1；此时 Job 已关闭。
        if (execution.error) {
            parentFailure =
                "code" in execution.error && execution.error.code === "ETIMEDOUT"
                    ? "native-timeout"
                    : "native-error";
            throw new Error();
        }
        if (execution.signal) {
            parentFailure = "native-signal";
            throw new Error();
        }
        if (execution.status !== 1) {
            parentFailure = "native-exit";
            throw new Error();
        }
        if (!fs.existsSync(result)) {
            parentFailure = "result-missing";
            throw new Error();
        }
        parentFailure = "result-invalid";
        const resultStat = fs.statSync(result);
        if (!resultStat.isFile() || resultStat.size > 2 * 1024 * 1024) {
            parentFailure = "result-invalid";
            throw new Error();
        }
        const value: unknown = JSON.parse(fs.readFileSync(result, "utf8"));
        if (isWindowsVerificationFailure(value)) {
            parentFailure = "worker-failed";
            throw new Error();
        }
        if (!isWindowsVerificationResult(value, expected)) {
            parentFailure = "result-invalid";
            throw new Error();
        }
        cleanup = true;
        const schemaFile = path.join(root, "schemas.json");
        const temporary = `${schemaFile}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, value.schemas, { flag: "wx", mode: 0o600 });
            fs.renameSync(temporary, schemaFile);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
        return {
            dependencies: generationVerification(plan),
            management: expected,
        };
    } catch {
        try {
            fs.writeFileSync(
                path.join(allocation, "parent-failure.json"),
                JSON.stringify({ schemaVersion: 1, reason: parentFailure }),
                { flag: "wx", mode: 0o600 },
            );
        } catch {
            // allocation 自身不可写时保留原失败；绝不以诊断收据覆盖验证结论。
        }
        throw new Error("Windows 管理程序候选未通过 Job Object 隔离验证");
    } finally {
        // 只有 native host 已返回、Job 已关闭时才清理；超时/派发错误保留证据并 fail-close。
        if (cleanup) fs.rmSync(allocation, { recursive: true, force: true });
    }
}

function isWindowsVerificationFailure(value: unknown): boolean {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Reflect.ownKeys(value).length === 2 &&
        (value as Record<string, unknown>).failed === true &&
        typeof (value as Record<string, unknown>).stage === "string" &&
        [
            "request",
            "dependencies",
            "package-identity",
            "workspace",
            "authentication",
            "management-startup",
            "management-state",
            "web-page",
            "web-asset",
            "authentication-v2",
            "anonymous-denied",
            "management-close",
            "authentication-preserved",
        ].includes((value as Record<string, string>).stage),
    );
}

function isWindowsVerificationResult(
    value: unknown,
    expected: ManagerCandidateVerification,
): value is { schemas: string; verification: ManagerCandidateVerification } {
    if (
        !value ||
        typeof value !== "object" ||
        !("schemas" in value) ||
        typeof value.schemas !== "string" ||
        Buffer.byteLength(value.schemas) > 1024 * 1024 ||
        !("verification" in value) ||
        JSON.stringify(value.verification) !== JSON.stringify(expected)
    )
        return false;
    try {
        const parsed: unknown = JSON.parse(value.schemas);
        return Boolean(
            parsed &&
            typeof parsed === "object" &&
            "schemaVersion" in parsed &&
            parsed.schemaVersion === 1 &&
            "adapters" in parsed &&
            parsed.adapters &&
            "protocols" in parsed &&
            parsed.protocols &&
            "applications" in parsed &&
            parsed.applications &&
            "runtimeOnly" in parsed &&
            Array.isArray(parsed.runtimeOnly),
        );
    } catch {
        return false;
    }
}

function generationVerification(plan: GenerationPlan): GenerationVerification {
    return {
        planDigest: plan.digest,
        hostVersion: plan.host.version,
        coreVersion: plan.core.version,
        nodeAbi: plan.nodeAbi,
        platform: plan.platform,
        arch: plan.arch,
        checks: {
            packageIdentity: true,
            peerDependencies: true,
            singleHost: true,
            loadRegistration: true,
            schemas: true,
        },
    };
}

/** 受限 console worker 不实现 manager HTTP RPC；生产 service-run 不使用此参数。 */
export function windowsManagerCandidateHostArguments(input: {
    id: string;
    root: string;
    worker: string;
    request: string;
    result: string;
    sid: string;
}): string[] {
    return [
        "console-run",
        "--no-manager-rpc",
        "--manager",
        process.execPath,
        "--manager-arg",
        input.worker,
        "--manager-arg",
        "--request",
        "--manager-arg",
        input.request,
        "--manager-arg",
        "--result",
        "--manager-arg",
        input.result,
        "--working-dir",
        input.root,
        "--pipe",
        `\\\\.\\pipe\\onebots-candidate-${input.id}`,
        "--control-sid",
        input.sid,
        "--stop-timeout",
        "20s",
    ];
}
