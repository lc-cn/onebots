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
        return verifyWindowsManagerCandidate(root, options.privateRoot, expected, timeoutMs);
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
    root: string,
    privateRoot: string,
    expected: ManagerCandidateVerification,
    timeoutMs: number,
): ManagerCandidateVerification {
    const host = createDefaultServiceHost();
    const id = randomUUID();
    const allocation = path.join(path.resolve(privateRoot), `windows-${id}`);
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
    try {
        secureWindowsServiceDirectory(host, allocation);
        fs.writeFileSync(
            request,
            JSON.stringify({ root, workspace: path.join(allocation, "workspace"), expected }),
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
        if (execution.error || execution.signal || execution.status !== 1) throw new Error();
        const value: unknown = JSON.parse(fs.readFileSync(result, "utf8"));
        if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error();
        cleanup = true;
        return expected;
    } catch {
        throw new Error("Windows 管理程序候选未通过 Job Object 隔离验证");
    } finally {
        // 只有 native host 已返回、Job 已关闭时才清理；超时/派发错误保留证据并 fail-close。
        if (cleanup) fs.rmSync(allocation, { recursive: true, force: true });
    }
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
