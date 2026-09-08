import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerationPlan, type GenerationPlan } from "../installation/generation-plan.js";
import { allocateConfigurationVerification } from "../configuration/configuration-verify-ownership.js";
import { runOwnedWorker } from "./owned-worker.js";

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
        process.platform === "win32" ||
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
    const allocation = allocateConfigurationVerification(options.privateRoot);
    const lifecycle = { cleanupAllowed: true };
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
