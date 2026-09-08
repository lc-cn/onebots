import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import type {
    GatewayController,
    GatewayControllerState,
    GatewayOperation,
} from "./gateway-controller.js";

export interface ActiveGenerationPointer {
    id: string;
    planDigest: string;
}

export interface GenerationActivationOperation {
    id: string;
    status: "running" | "succeeded" | "failed";
    phase: "accepted" | "stopping" | "starting" | "restoring" | "completed" | "failed";
    previous: ActiveGenerationPointer | null;
    target: ActiveGenerationPointer;
    desiredBefore: "running" | "stopped";
    startedAt: string;
    finishedAt?: string;
    error?: string;
    rolledBack?: boolean;
}

export interface GenerationActivationState {
    schemaVersion: 1;
    /** null is the bundled runtime, never a fabricated verified generation id. */
    active: ActiveGenerationPointer | null;
    recoveryRequired: boolean;
    operations: GenerationActivationOperation[];
    error?: string;
}

export interface GenerationActivationOptions {
    statePath: string;
    gateway: GatewayController;
    /** Must be the trusted generation store's readVerified, including receipt/file validation. */
    readVerified(id: string): VerifiedGeneration;
    /** Only proves children owned by this live manager; never use as cold-start orphan proof. */
    hasLiveChildren(): boolean;
    configurationRecoveryRequired?(): boolean;
    /** Verify candidate configuration under the lifecycle queue; guard must synchronously recheck its snapshot. */
    verifyActivation?(generation: VerifiedGeneration): Promise<() => void>;
}

/** 仅供可信配置服务使用；事务中必须 await 操作，不得调用外层 facade。 */
export interface ConfigurationTransactionPort {
    activeGenerationId(): string | null;
    hasLiveChildren(): boolean;
    gatewayStatus(): { desired: "running" | "stopped"; recoveryRequired?: boolean };
    suspend(): Promise<{ status: string }>;
    start(): Promise<{ status: string }>;
}

/** 恢复事务只读取生命周期事实；不能启动、停止或自行对账未知实例。 */
export type ConfigurationRecoveryTransactionPort = Pick<
    ConfigurationTransactionPort,
    "activeGenerationId" | "hasLiveChildren" | "gatewayStatus"
>;

/**
 * Host must route ALL start/stop/restart/shutdown/activate writes through this facade.
 * Do not also expose its underlying GatewayController to client handlers or recovery timers.
 * Driver prepare reads activeGeneration(); observeExit may report facts directly to gateway.
 */
export class GenerationActivationController {
    private state: GenerationActivationState = {
        schemaVersion: 1,
        active: null,
        recoveryRequired: false,
        operations: [],
    };
    private initialized = false;
    private queue: Promise<unknown> = Promise.resolve();
    private readonly configurationContext = new AsyncLocalStorage<boolean>();

    constructor(private readonly options: GenerationActivationOptions) {}

    initialize(): Promise<void> {
        return this.serial(async () => {
            if (this.initialized) return;
            try {
                this.state = parseState(JSON.parse(await readFile(this.options.statePath, "utf8")));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                // A missing pointer record is the initial bundled runtime.
            }
            for (const operation of this.state.operations) {
                if (operation.status !== "running") continue;
                operation.status = "failed";
                operation.phase = "failed";
                operation.finishedAt = new Date().toISOString();
                operation.error = "前次版本切换中断，结果未知，必须人工对账";
                this.state.recoveryRequired = true;
                this.state.error = operation.error;
            }
            if (this.state.active) this.verifyPointer(this.state.active);
            await this.persist();
            await this.options.gateway.initialize();
            this.initialized = true;
        });
    }

    status(): GenerationActivationState & { gateway: GatewayControllerState } {
        return { ...structuredClone(this.state), gateway: this.options.gateway.status() };
    }

    activeGeneration(): VerifiedGeneration | null {
        return this.state.active ? this.verifyPointer(this.state.active) : null;
    }

    start(): Promise<GatewayOperation> {
        return this.lifecycle("start");
    }
    stop(): Promise<GatewayOperation> {
        return this.lifecycle("stop");
    }
    restart(): Promise<GatewayOperation> {
        return this.lifecycle("restart");
    }
    shutdown(): Promise<GatewayOperation> {
        return this.lifecycle("shutdown");
    }

    runConfigurationTransaction<T>(
        task: (port: ConfigurationTransactionPort) => Promise<T>,
    ): Promise<T> {
        return this.serial(async () => {
            this.assertWritable();
            let open = true;
            const pending = new Set<Promise<unknown>>();
            const check = () => {
                if (!open) throw new Error("配置事务已结束");
            };
            const action = (method: "start" | "suspend") => {
                check();
                const result = this.options.gateway[method]();
                pending.add(result);
                // 即使可信调用方忘记 await，也不能让生命周期操作跨出事务队列。
                void result.then(
                    () => pending.delete(result),
                    () => pending.delete(result),
                );
                return result;
            };
            const port: ConfigurationTransactionPort = {
                activeGenerationId: () => {
                    check();
                    return this.state.active?.id ?? null;
                },
                hasLiveChildren: () => {
                    check();
                    return this.options.hasLiveChildren();
                },
                gatewayStatus: () => {
                    check();
                    const { desired, recoveryRequired } = this.options.gateway.status();
                    return { desired, recoveryRequired };
                },
                suspend: () => action("suspend"),
                start: () => action("start"),
            };
            try {
                return await this.configurationContext.run(true, () => task(port));
            } finally {
                open = false;
                await Promise.allSettled([...pending]);
            }
        });
    }

    runConfigurationRecoveryTransaction<T>(
        task: (port: ConfigurationRecoveryTransactionPort) => Promise<T>,
    ): Promise<T> {
        return this.serial(async () => {
            this.assertInitialized();
            if (this.state.recoveryRequired) throw new Error("版本切换需要对账，禁止恢复配置");
            if (this.options.gateway.status().recoveryRequired)
                throw new Error("网关实例需要对账，禁止恢复配置");
            if (this.options.hasLiveChildren()) throw new Error("网关子进程仍存活，禁止恢复配置");
            let open = true;
            const check = () => {
                if (!open) throw new Error("配置事务已结束");
            };
            const port: ConfigurationRecoveryTransactionPort = {
                activeGenerationId: () => {
                    check();
                    return this.state.active?.id ?? null;
                },
                hasLiveChildren: () => {
                    check();
                    return this.options.hasLiveChildren();
                },
                gatewayStatus: () => {
                    check();
                    const { desired, recoveryRequired } = this.options.gateway.status();
                    return { desired, recoveryRequired };
                },
            };
            try {
                return await this.configurationContext.run(true, () => task(port));
            } finally {
                open = false;
            }
        });
    }

    /** Host supplies identity-aware evidence; absence from a fresh driver's map is not evidence. */
    reconcileStopped(confirm: (state: GatewayControllerState) => boolean): Promise<void> {
        return this.serial(async () => {
            this.assertInitialized();
            if (this.state.recoveryRequired) throw new Error("版本切换需要对账，不能仅对账网关");
            if (!confirm(this.options.gateway.status())) throw new Error("缺少旧网关已退出的证据");
            requireSuccess(await this.options.gateway.reconcileStopped());
        });
    }

    activate(id: string, expected?: string | null): Promise<GenerationActivationOperation> {
        return this.serial(async () => {
            this.assertWritable();
            const verified = this.options.readVerified(id);
            const target = pointer(verified, id);
            if (samePointer(this.state.active, target)) {
                const previous = [...this.state.operations]
                    .reverse()
                    .find(
                        operation =>
                            operation.status === "succeeded" &&
                            samePointer(operation.target, target),
                    );
                if (previous) return structuredClone(previous);
            } else if (expected !== undefined && expected !== (this.state.active?.id ?? null)) {
                throw new GenerationConflictError();
            }
            const assertCurrent = await this.options.verifyActivation?.(verified);
            const before = structuredClone(this.state);
            const operation: GenerationActivationOperation = {
                id: randomUUID(),
                status: "running",
                phase: "accepted",
                previous: structuredClone(this.state.active),
                target,
                desiredBefore: this.options.gateway.status().desired,
                startedAt: new Date().toISOString(),
            };
            this.state.operations.push(operation);
            try {
                await this.persist();
            } catch (error) {
                this.state = before;
                throw error;
            }
            let effectsStarted = false;
            try {
                assertCurrent?.();
                if (samePointer(operation.previous, target)) {
                    this.complete(operation);
                    await this.persist();
                    return structuredClone(operation);
                }
                operation.phase = "stopping";
                await this.persist();
                assertCurrent?.();
                effectsStarted = true;
                requireSuccess(await this.options.gateway.suspend());
                if (this.options.hasLiveChildren()) throw new Error("旧网关仍存活，禁止切换");
                assertCurrent?.();
                this.state.active = target;
                operation.phase = "starting";
                await this.persist();
                // Re-read receipt immediately before use; install success is not proof of readiness.
                this.verifyPointer(target);
                if (operation.desiredBefore === "running")
                    requireSuccess(await this.options.gateway.start());
                this.complete(operation);
                await this.persist();
            } catch (error) {
                if (!effectsStarted) {
                    operation.status = "failed";
                    operation.phase = "failed";
                    operation.finishedAt = new Date().toISOString();
                    operation.error = "候选版本激活前检查失败，未执行网关切换";
                    try {
                        await this.persist();
                    } catch (persistenceError) {
                        this.markUnknown(operation, persistenceError);
                        throw persistenceError;
                    }
                    return structuredClone(operation);
                }
                if (!(error instanceof GatewayActionFailure) || this.options.hasLiveChildren()) {
                    this.markUnknown(operation, error);
                    // Persist when possible; failure leaves the previous unfinished record for recovery.
                    await this.persist();
                    return structuredClone(operation);
                }
                await this.restore(operation, error);
            }
            return structuredClone(operation);
        });
    }

    private async restore(
        operation: GenerationActivationOperation,
        originalError: Error,
    ): Promise<void> {
        operation.phase = "restoring";
        operation.error = originalError.message;
        try {
            await this.persist();
            // This proof applies only to the driver in this process, after its failed operation returned.
            if (this.options.hasLiveChildren()) throw new Error("失败网关尚未回收，不能回滚");
            requireSuccess(await this.options.gateway.reconcileStopped());
            if (operation.previous) this.verifyPointer(operation.previous);
            this.state.active = structuredClone(operation.previous);
            await this.persist();
            if (operation.desiredBefore === "running")
                requireSuccess(await this.options.gateway.start());
            operation.rolledBack = true;
            operation.status = "failed";
            operation.phase = "failed";
            operation.finishedAt = new Date().toISOString();
            await this.persist();
        } catch (error) {
            this.markUnknown(
                operation,
                new Error(
                    `切换失败且恢复未完成：${error instanceof Error ? error.message : String(error)}`,
                ),
            );
            await this.persist();
        }
    }

    private lifecycle(
        action: "start" | "stop" | "restart" | "shutdown",
    ): Promise<GatewayOperation> {
        return this.serial(async () => {
            this.assertInitialized();
            if (action === "start" || action === "restart") this.assertWritable();
            return this.options.gateway[action]();
        });
    }

    private verifyPointer(value: ActiveGenerationPointer): VerifiedGeneration {
        const verified = this.options.readVerified(value.id);
        const current = pointer(verified, value.id);
        if (!samePointer(current, value)) throw new Error("活动版本的验证收据已改变");
        return verified;
    }

    private complete(operation: GenerationActivationOperation): void {
        operation.status = "succeeded";
        operation.phase = "completed";
        operation.finishedAt = new Date().toISOString();
    }

    private markUnknown(operation: GenerationActivationOperation, error: unknown): void {
        delete operation.rolledBack;
        operation.status = "failed";
        operation.phase = "failed";
        operation.finishedAt = new Date().toISOString();
        operation.error = `版本切换结果未知：${error instanceof Error ? error.message : String(error)}`;
        this.state.recoveryRequired = true;
        this.state.error = operation.error;
    }

    private assertInitialized(): void {
        if (!this.initialized) throw new Error("版本激活控制器尚未初始化");
    }

    private assertWritable(): void {
        this.assertInitialized();
        if (this.options.configurationRecoveryRequired?.())
            throw new Error("配置事务需要对账，禁止继续启动或切换");
        if (this.state.recoveryRequired) throw new Error("版本切换需要对账，禁止继续启动或切换");
        if (this.options.gateway.status().recoveryRequired)
            throw new Error("网关实例需要对账，禁止在未知旧实例之上启动或切换");
    }

    private serial<T>(task: () => Promise<T>): Promise<T> {
        if (this.configurationContext.getStore())
            return Promise.reject(
                new Error("配置事务内部必须使用事务端口，不能调用生命周期 facade"),
            );
        const result = this.queue.then(task);
        this.queue = result.catch(() => undefined); // Each caller receives its own failure.
        return result;
    }

    private async persist(): Promise<void> {
        const directory = dirname(this.options.statePath);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${this.options.statePath}.${randomUUID()}.tmp`;
        try {
            const file = await open(temporary, "wx", 0o600);
            try {
                await file.writeFile(JSON.stringify(this.state));
                await file.sync();
            } finally {
                await file.close();
            }
            await rename(temporary, this.options.statePath);
            if (process.platform !== "win32") {
                const folder = await open(directory, "r");
                try {
                    await folder.sync();
                } finally {
                    await folder.close();
                }
            }
        } finally {
            await unlink(temporary).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            });
        }
    }
}

class GatewayActionFailure extends Error {}
function requireSuccess(operation: GatewayOperation): void {
    if (operation.status !== "succeeded")
        throw new GatewayActionFailure(operation.error ?? "网关操作失败");
}

function pointer(generation: VerifiedGeneration, expectedId: string): ActiveGenerationPointer {
    if (
        generation.id !== expectedId ||
        generation.receipt?.id !== expectedId ||
        generation.receipt.phase !== "verified" ||
        generation.planDigest !== generation.receipt.planDigest ||
        !/^[a-f0-9]{64}$/.test(generation.planDigest)
    )
        throw new Error("版本缺少有效验证收据");
    return { id: generation.id, planDigest: generation.planDigest };
}

function samePointer(
    left: ActiveGenerationPointer | null,
    right: ActiveGenerationPointer | null,
): boolean {
    return left?.id === right?.id && left?.planDigest === right?.planDigest;
}

function parseState(value: unknown): GenerationActivationState {
    if (!value || typeof value !== "object") throw new Error("版本指针记录损坏");
    const state = value as GenerationActivationState;
    const validPointer = (item: ActiveGenerationPointer | null) =>
        item === null ||
        (item && typeof item.id === "string" && /^[a-f0-9]{64}$/.test(item.planDigest));
    if (
        state.schemaVersion !== 1 ||
        !validPointer(state.active) ||
        typeof state.recoveryRequired !== "boolean" ||
        !Array.isArray(state.operations) ||
        state.operations.some(
            operation =>
                !operation ||
                typeof operation.id !== "string" ||
                !["running", "succeeded", "failed"].includes(operation.status) ||
                !validPointer(operation.previous) ||
                !operation.target ||
                !validPointer(operation.target) ||
                !["running", "stopped"].includes(operation.desiredBefore),
        )
    )
        throw new Error("版本指针记录格式无效");
    return state;
}

export class GenerationConflictError extends Error {
    constructor() {
        super("运行版本已变化，请刷新并重新确认安装计划");
    }
}
