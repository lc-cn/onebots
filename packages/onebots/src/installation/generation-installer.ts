import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createGenerationPlan, type GenerationPlan } from "./generation-plan.js";
import { downloadGeneration, type GenerationDownloadInput } from "./generation-download.js";
import { GenerationStore, type GenerationVerification } from "./generation-store.js";
import {
    observePersistedOperation,
    type PersistedOperationObserver,
} from "../persisted-operation-observer.js";

export interface GenerationInstallOperation {
    schemaVersion: 1;
    id: string;
    planDigest: string;
    phase: "queued" | "downloading" | "verifying" | "verified" | "failed" | "interrupted";
    candidateId?: string;
    createdAt: string;
    finishedAt?: string;
    error?:
        | "ARTIFACT_INPUT_FAILED"
        | "CANDIDATE_ALLOCATION_FAILED"
        | "DOWNLOAD_FAILED"
        | "VERIFICATION_FAILED"
        | "INSTALL_FAILED"
        | "INTERRUPTED";
}

export interface GenerationInstallerOptions {
    operationsDirectory: string;
    store: GenerationStore;
    verify(
        directory: string,
        plan: GenerationPlan,
        options: { signal?: AbortSignal; privateRoot: string },
    ): Promise<GenerationVerification>;
    /** 仅受信宿主配置可覆盖执行器，HTTP 请求不得指定可执行文件或验证器。 */
    download?: (input: GenerationDownloadInput) => Promise<void>;
    pnpmExecutable?: string;
    pnpmScript?: string;
    onOperation?: PersistedOperationObserver;
}

/**
 * 在独占工作区内持久化并串行执行安装；验证成功也不改变活动版本。
 * 重复请求复用同一操作。冷启动发现中断时保留候选供恢复诊断，不自动重试或清理。
 */
export class GenerationInstaller {
    private readonly directory: string;
    private readonly running = new Map<string, Promise<GenerationInstallOperation>>();
    private tail: Promise<unknown> = Promise.resolve();
    private closed = false;

    constructor(private readonly options: GenerationInstallerOptions) {
        fs.mkdirSync(options.operationsDirectory, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(options.operationsDirectory).isSymbolicLink())
            throw new Error("安装操作目录不能是符号链接");
        this.directory = fs.realpathSync(options.operationsDirectory);
        fs.chmodSync(this.directory, 0o700);
        for (const name of fs.readdirSync(this.directory)) {
            if (!name.endsWith(".json")) continue;
            const operation = this.status(name.slice(0, -5));
            if (["queued", "downloading", "verifying"].includes(operation.phase)) {
                const interrupted = {
                    ...operation,
                    phase: "interrupted" as const,
                    error: "INTERRUPTED" as const,
                    finishedAt: new Date().toISOString(),
                };
                this.save(interrupted);
                this.observe(interrupted);
            }
        }
    }

    status(id: string): GenerationInstallOperation {
        const file = this.file(id);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16_384)
            throw new Error("安装操作记录无效");
        const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!isOperation(value) || value.id !== id) throw new Error("安装操作记录无效");
        if (value.phase === "verified") {
            if (!value.candidateId) throw new Error("已验证安装缺少候选版本");
            const generation = this.options.store.readVerified(value.candidateId);
            if (generation.operationId !== id || generation.planDigest !== value.planDigest)
                throw new Error("安装结果与版本验证收据不一致");
        }
        return value;
    }

    install(
        id: string,
        input: GenerationPlan,
        options: { token?: string; signal?: AbortSignal } = {},
    ): Promise<GenerationInstallOperation> {
        if (this.closed) return Promise.reject(new Error("安装服务正在关闭"));
        this.file(id);
        // 从原始约束重新生成，拒绝伪造的 manifest、digest 和隐含选项。
        const plan = createGenerationPlan({ ...input, target: input });
        if (JSON.stringify(plan) !== JSON.stringify(input))
            throw new Error("安装计划已变化，请重新确认");
        if (fs.existsSync(this.file(id))) {
            const existing = this.status(id);
            if (existing.planDigest !== plan.digest)
                throw new Error("此安装操作标识已用于其他计划");
            return this.running.get(id) ?? Promise.resolve(existing);
        }
        const operation: GenerationInstallOperation = {
            schemaVersion: 1,
            id,
            planDigest: plan.digest,
            phase: "queued",
            createdAt: new Date().toISOString(),
        };
        // 先落盘再安排任何下载或包代码执行；凭据只留在当前调用内存。
        this.save(operation);
        const executionOptions = { token: options.token, signal: options.signal };
        const run = this.tail.then(() => this.execute(operation, plan, executionOptions));
        this.tail = run.catch(() => undefined);
        this.running.set(id, run);
        void run.then(
            () => this.running.delete(id),
            () => this.running.delete(id),
        );
        return run;
    }

    /** 正常关闭等待所有已接受操作完成；上层可先取消其 AbortSignal。 */
    async close(): Promise<void> {
        this.closed = true;
        await this.tail;
    }

    private async execute(
        operation: GenerationInstallOperation,
        plan: GenerationPlan,
        options: { token?: string; signal?: AbortSignal },
    ): Promise<GenerationInstallOperation> {
        let current = operation;
        let failureCode:
            | "ARTIFACT_INPUT_FAILED"
            | "CANDIDATE_ALLOCATION_FAILED"
            | "DOWNLOAD_FAILED"
            | "VERIFICATION_FAILED" = "ARTIFACT_INPUT_FAILED";
        try {
            options.signal?.throwIfAborted();
            verifyLocalArtifacts(plan);
            failureCode = "CANDIDATE_ALLOCATION_FAILED";
            const candidate = this.options.store.allocate(operation.id, plan.digest);
            current = { ...current, phase: "downloading", candidateId: candidate.id };
            this.save(current);
            failureCode = "DOWNLOAD_FAILED";
            try {
                await (this.options.download ?? downloadGeneration)({
                    directory: candidate.directory,
                    manifest: plan.manifest,
                    token: options.token,
                    signal: options.signal,
                    pnpmExecutable: this.options.pnpmExecutable,
                    pnpmScript: this.options.pnpmScript,
                    credentialRoot: path.join(path.dirname(this.directory), "downloads"),
                });
            } finally {
                // Keep no installer-owned credential reference while verification code runs.
                options.token = undefined;
            }
            // 下载器返回前必须销毁临时认证。验证器不接收 token。
            options.signal?.throwIfAborted();
            const planDescriptor = fs.openSync(
                path.join(candidate.directory, "plan.json"),
                "wx",
                0o600,
            );
            try {
                fs.writeFileSync(planDescriptor, JSON.stringify(plan) + "\n");
                fs.fsyncSync(planDescriptor);
            } finally {
                fs.closeSync(planDescriptor);
            }
            current = { ...current, phase: "verifying" };
            this.save(current);
            failureCode = "VERIFICATION_FAILED";
            const evidence = await this.options.verify(candidate.directory, plan, {
                privateRoot: path.join(path.dirname(this.directory), "generation-verifications"),
                signal: options.signal,
            });
            options.signal?.throwIfAborted();
            this.options.store.commitVerified(candidate.id, evidence);
            current = { ...current, phase: "verified", finishedAt: new Date().toISOString() };
            this.save(current);
            this.observe(current);
            return current;
        } catch {
            options.token = undefined;
            // A receipt may have committed before its final operation record failed to flush.
            let receiptExists = false;
            if (current.candidateId) {
                try {
                    const generation = this.options.store.readVerified(current.candidateId);
                    receiptExists =
                        generation.operationId === current.id &&
                        generation.planDigest === plan.digest;
                } catch {
                    // Failed download/verification normally has no receipt; never treat that as success.
                }
            }
            // 第三方异常可能包含 registry token 或配置片段，持久化固定诊断类别。
            const failed: GenerationInstallOperation = {
                ...current,
                phase: receiptExists ? "interrupted" : "failed",
                error: receiptExists ? "INTERRUPTED" : failureCode,
                finishedAt: new Date().toISOString(),
            };
            this.save(failed);
            this.observe(failed);
            return failed;
        }
    }

    private file(id: string): string {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("安装操作标识无效");
        return path.join(this.directory, `${id}.json`);
    }

    private save(operation: GenerationInstallOperation): void {
        const file = this.file(operation.id);
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            const descriptor = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(descriptor, JSON.stringify(operation) + "\n");
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            fs.renameSync(temporary, file);
            if (process.platform !== "win32") {
                const directory = fs.openSync(this.directory, "r");
                try {
                    fs.fsyncSync(directory);
                } finally {
                    fs.closeSync(directory);
                }
            }
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }

    private observe(operation: GenerationInstallOperation): void {
        if (!operation.finishedAt) return;
        observePersistedOperation(this.options.onOperation, {
            id: operation.id,
            action: "installation.install",
            status:
                operation.phase === "verified"
                    ? "succeeded"
                    : operation.phase === "interrupted"
                      ? "interrupted"
                      : "failed",
            phase: operation.phase,
            finishedAt: operation.finishedAt,
        });
    }
}

function verifyLocalArtifacts(plan: GenerationPlan): void {
    for (const artifact of [plan.host, plan.core, ...plan.extensions]) {
        if (!artifact.spec.startsWith("file:")) continue;
        const file = artifact.spec.slice(5);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024)
            throw new Error("本地工件文件无效");
        const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        if (digest !== artifact.sha256) throw new Error("本地工件已变化，请重新生成安装计划");
    }
}

function isOperation(value: unknown): value is GenerationInstallOperation {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    return (
        item.schemaVersion === 1 &&
        typeof item.id === "string" &&
        typeof item.planDigest === "string" &&
        /^[a-f0-9]{64}$/.test(item.planDigest) &&
        typeof item.phase === "string" &&
        ["queued", "downloading", "verifying", "verified", "failed", "interrupted"].includes(
            item.phase,
        ) &&
        typeof item.createdAt === "string" &&
        Number.isFinite(Date.parse(item.createdAt)) &&
        (item.candidateId === undefined ||
            (typeof item.candidateId === "string" && /^[a-f0-9-]{36}$/.test(item.candidateId))) &&
        (item.finishedAt === undefined ||
            (typeof item.finishedAt === "string" &&
                Number.isFinite(Date.parse(item.finishedAt)))) &&
        (item.error === undefined ||
            item.error === "ARTIFACT_INPUT_FAILED" ||
            item.error === "CANDIDATE_ALLOCATION_FAILED" ||
            item.error === "DOWNLOAD_FAILED" ||
            item.error === "VERIFICATION_FAILED" ||
            item.error === "INSTALL_FAILED" ||
            item.error === "INTERRUPTED")
    );
}
