import { runOwnedWorker, OwnedWorkerError } from "../verification/owned-worker.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createGenerationPlan, type GenerationPlan } from "./generation-plan.js";
import {
    allocateConfigurationVerification,
    type ConfigurationVerificationOwner,
} from "../configuration/configuration-verify-ownership.js";
import type { GenerationVerification } from "./generation-store.js";

export interface GenerationVerifyOptions {
    /** 管理服务必须传工作区内私有所有权目录。 */
    privateRoot?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

/** 进程/凭据隔离，不是恶意插件的网络或文件系统沙箱。 */
export async function verifyGeneration(
    directory: string,
    plan: GenerationPlan,
    options: GenerationVerifyOptions = {},
): Promise<GenerationVerification> {
    if (process.platform === "win32") throw new Error("当前平台无法确认验证进程组退出");
    const timeout = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000)
        throw new Error("验证超时设置无效");
    if (options.signal?.aborted) throw new Error("候选验证已取消");
    const verifiedPlan = createGenerationPlan({
        ...plan,
        target: { platform: plan.platform, arch: plan.arch, nodeAbi: plan.nodeAbi },
    });
    if (
        verifiedPlan.digest !== plan.digest ||
        plan.nodeAbi !== process.versions.modules ||
        plan.platform !== process.platform ||
        plan.arch !== process.arch
    )
        throw new Error("候选计划或运行环境不匹配");
    const root = fs.realpathSync(directory);
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("候选目录不能是符号链接");
    const schemaFile = path.join(root, "schemas.json");
    if (fs.existsSync(path.join(root, "receipt.json")))
        throw new Error("不能重新验证已提交运行版本");
    const { directory: home, owner } = allocateConfigurationVerification(
        options.privateRoot ??
            path.join(
                os.tmpdir(),
                `onebots-generation-verifications-${process.getuid?.() ?? "user"}`,
            ),
    );
    const lifecycle = { cleanupAllowed: true };
    try {
        const schemas = await runWorker(
            root,
            verifiedPlan,
            home,
            owner,
            lifecycle,
            timeout,
            options.signal,
        );
        const temporary = `${schemaFile}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, schemas, { flag: "wx", mode: 0o600 });
            fs.renameSync(temporary, schemaFile);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
        return {
            planDigest: verifiedPlan.digest,
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
    } finally {
        if (lifecycle.cleanupAllowed) fs.rmSync(home, { recursive: true, force: true });
    }
}

function runWorker(
    directory: string,
    plan: GenerationPlan,
    home: string,
    owner: ConfigurationVerificationOwner,
    lifecycle: { cleanupAllowed: boolean },
    timeout: number,
    signal?: AbortSignal,
): Promise<string> {
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    let decodeError: Error | undefined;
    return runOwnedWorker({
        entrypoint: fileURLToPath(
            new URL(`./generation-verify-worker.${extension}`, import.meta.url),
        ),
        cwd: directory,
        directory: home,
        owner,
        request: { directory, plan },
        timeoutMs: timeout,
        signal,
        lifecycle,
        decode(value: unknown): string {
            if (
                !value ||
                typeof value !== "object" ||
                !("schemas" in value) ||
                typeof value.schemas !== "string" ||
                Buffer.byteLength(value.schemas) > 1024 * 1024
            ) {
                decodeError = new Error("候选依赖、宿主身份或插件注册验证失败");
                throw decodeError;
            }
            try {
                const parsed = JSON.parse(value.schemas);
                if (
                    parsed.schemaVersion !== 1 ||
                    !parsed.adapters ||
                    !parsed.protocols ||
                    !parsed.applications ||
                    !Array.isArray(parsed.runtimeOnly)
                )
                    throw new Error();
                return value.schemas;
            } catch {
                decodeError = new Error("候选 Schema 验证失败");
                throw decodeError;
            }
        },
    }).catch((error: unknown) => {
        if (!(error instanceof OwnedWorkerError)) throw error;
        const messages = {
            CANCELLED: "候选验证已取消",
            TIMEOUT: "候选验证超时",
            CLEANUP_FAILED: "候选验证进程组无法确认退出，已保留所有权记录",
            WORKER_FAILED: "候选验证进程失败",
        };
        throw error.code === "WORKER_FAILED" && decodeError
            ? decodeError
            : new Error(messages[error.code]);
    });
}
