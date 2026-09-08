import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createGenerationPlan, type GenerationPlan } from "./generation-plan.js";
import {
    allocateConfigurationVerification,
    writeConfigurationVerificationOwner,
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
    return new Promise((resolve, reject) => {
        const environment: NodeJS.ProcessEnv = {
            HOME: home,
            USERPROFILE: home,
            TMPDIR: home,
            TMP: home,
            TEMP: home,
            NODE_ENV: "production",
            ONEBOTS_VERIFY_PROCESS_GROUP: process.platform === "win32" ? "0" : "1",
        };
        for (const key of ["PATH", "SystemRoot", "WINDIR", "LANG", "LC_ALL"]) {
            if (process.env[key]) environment[key] = process.env[key];
        }
        const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
        owner.phase = "spawning";
        writeConfigurationVerificationOwner(home, owner);
        const worker = fork(
            fileURLToPath(new URL(`./generation-verify-worker.${extension}`, import.meta.url)),
            [],
            {
                cwd: directory,
                env: environment,
                execArgv: [],
                detached: process.platform !== "win32",
                stdio: ["ignore", "ignore", "ignore", "ipc"],
            },
        );
        lifecycle.cleanupAllowed = false;
        let schemas: string | undefined;
        let error: Error | undefined;
        const killOwnedGroup = () => {
            if (!worker.pid) return;
            try {
                if (process.platform === "win32") worker.kill("SIGKILL");
                else process.kill(-worker.pid, "SIGKILL");
            } catch (cause) {
                if ((cause as NodeJS.ErrnoException).code !== "ESRCH")
                    error ??= new Error("候选验证进程组无法回收");
            }
        };
        const fail = (message: string) => {
            error ??= new Error(message);
            killOwnedGroup();
        };
        const abort = () => fail("候选验证已取消");
        const timer = setTimeout(() => fail("候选验证超时"), timeout);
        signal?.addEventListener("abort", abort, { once: true });
        worker.on("error", () => fail("候选验证进程失败"));
        worker.on("message", value => {
            if (
                schemas !== undefined ||
                !value ||
                typeof value !== "object" ||
                !("schemas" in value) ||
                typeof value.schemas !== "string" ||
                Buffer.byteLength(value.schemas) > 1024 * 1024
            ) {
                fail("候选依赖、宿主身份或插件注册验证失败");
                return;
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
                schemas = value.schemas;
            } catch {
                fail("候选 Schema 验证失败");
            }
        });
        worker.once("close", async code => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            let reaped = true;
            // Plugin imports can create ordinary helpers; ready/exit alone does not reap them.
            if (process.platform !== "win32" && worker.pid) {
                killOwnedGroup();
                for (let attempt = 0; attempt < 100; attempt++) {
                    try {
                        process.kill(-worker.pid, 0);
                    } catch (cause) {
                        if ((cause as NodeJS.ErrnoException).code === "ESRCH") break;
                        reaped = false;
                        error ??= new Error("候选验证进程组无法确认退出");
                        break;
                    }
                    if (attempt === 99) {
                        reaped = false;
                        error ??= new Error("候选验证进程组仍存活");
                    } else await new Promise(done => setTimeout(done, 20));
                }
            }
            lifecycle.cleanupAllowed = reaped;
            if (error || code !== 0 || schemas === undefined)
                reject(error ?? new Error("候选验证进程未完成"));
            else resolve(schemas);
        });
        try {
            if (!worker.pid) throw new Error();
            owner.phase = "running";
            owner.workerPid = worker.pid;
            writeConfigurationVerificationOwner(home, owner);
            worker.send({ directory, plan }, sendError => {
                if (sendError) fail("候选验证进程通信失败");
            });
        } catch {
            fail("候选验证所有权记录失败");
        }
        if (signal?.aborted) abort();
    });
}
