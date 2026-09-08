import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export interface GatewayInstance {
    id: string;
    readonly pid?: number;
    readonly address?: { host: "127.0.0.1"; port: number };
}

/** start resolves only after handshake; stop resolves only after the child is reaped. */
export interface GatewayDriver {
    start(): Promise<GatewayInstance>;
    stop(instance: GatewayInstance): Promise<void>;
}

export type GatewayDesiredState = "running" | "stopped";
export type GatewayActualState = "starting" | "running" | "stopping" | "stopped" | "failed";
export interface GatewayOperation {
    id: string;
    action: "start" | "stop" | "restart" | "shutdown" | "reconcile" | "suspend";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt?: string;
    error?: string;
}

export interface GatewayControllerState {
    schemaVersion: 1;
    desired: GatewayDesiredState;
    actual: GatewayActualState;
    instance?: GatewayInstance;
    recoveryRequired: boolean;
    operations: GatewayOperation[];
    error?: string;
}

export interface GatewayControllerOptions {
    statePath: string;
    driver: GatewayDriver;
    initialDesired?: GatewayDesiredState;
}

/** One workspace lock must be held by the host throughout this controller's lifetime. */
export class GatewayController {
    private state: GatewayControllerState;
    private instance?: GatewayInstance;
    private initialized = false;
    private closed = false;
    private storageUncertain = false;
    private effectAttempted = false;
    private committedState?: GatewayControllerState;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly options: GatewayControllerOptions) {
        this.state = {
            schemaVersion: 1,
            desired: options.initialDesired ?? "stopped",
            actual: "stopped",
            recoveryRequired: false,
            operations: [],
        };
    }

    initialize(): Promise<GatewayControllerState> {
        return this.serial(async () => {
            if (this.initialized) return this.status();
            try {
                const parsed: unknown = JSON.parse(await readFile(this.options.statePath, "utf8"));
                this.state = parseState(parsed);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                // A missing state file is a new workspace, not a recovery failure.
            }
            if (
                this.state.instance ||
                ["starting", "running", "stopping"].includes(this.state.actual) ||
                this.state.operations.some(operation => operation.status === "running")
            ) {
                this.state.actual = "failed";
                this.state.recoveryRequired = true;
                this.state.error = "前次网关结果未知，需要核实旧实例已退出后才能启动";
                for (const operation of this.state.operations) {
                    if (operation.status !== "running") continue;
                    operation.status = "failed";
                    operation.finishedAt = new Date().toISOString();
                    operation.error = this.state.error;
                }
            }
            await this.persist();
            this.initialized = true;
            return this.status();
        });
    }

    status(): GatewayControllerState {
        return structuredClone(this.state);
    }

    /** Resolves with the final durable result, never just an acceptance acknowledgement. */
    start(): Promise<GatewayOperation> {
        return this.run("start", "running", () => this.startInstance());
    }

    stop(): Promise<GatewayOperation> {
        return this.run("stop", "stopped", () => this.stopInstance());
    }

    restart(): Promise<GatewayOperation> {
        return this.run("restart", "running", async () => {
            await this.stopInstance();
            await this.startInstance();
        });
    }

    /** Internal generation switch: release the current instance without changing user intent. */
    suspend(): Promise<GatewayOperation> {
        return this.run("suspend", undefined, () => this.stopInstance());
    }

    shutdown(): Promise<GatewayOperation> {
        return this.run("shutdown", undefined, async () => {
            this.closed = true;
            await this.stopInstance();
        });
    }

    /** Host must prove the old process/group is gone; a stale PID is never sufficient. */
    reconcileStopped(): Promise<GatewayOperation> {
        return this.run("reconcile", undefined, async () => {
            if (this.instance) throw new Error("仍持有运行实例，不能标记已退出");
            this.state.instance = undefined;
            this.state.recoveryRequired = false;
            this.state.actual = "stopped";
            this.state.error = undefined;
        });
    }

    /** Driver reports confirmed exit; do not await this callback inside driver.start/stop. */
    observeExit(instanceId: string, error?: string): Promise<void> {
        return this.serial(async () => {
            this.assertInitialized();
            if (this.instance?.id !== instanceId) return;
            this.instance = undefined;
            this.state.instance = undefined;
            this.state.recoveryRequired = false;
            this.state.actual = this.state.desired === "running" ? "failed" : "stopped";
            this.state.error =
                error ?? (this.state.actual === "failed" ? "网关意外退出" : undefined);
            try {
                await this.persist();
            } catch (error) {
                throw this.markUnknown(error);
            }
        });
    }

    private run(
        action: GatewayOperation["action"],
        desired: GatewayDesiredState | undefined,
        effect: () => Promise<void>,
    ): Promise<GatewayOperation> {
        return this.serial(async () => {
            this.assertInitialized();
            if (this.closed && !["shutdown", "stop", "reconcile"].includes(action))
                throw new Error("管理服务正在关闭");
            if (this.storageUncertain && ["start", "restart"].includes(action))
                throw new Error("持久化失败，前次操作结果未知；必须先停止或对账");
            const previous = this.status();
            this.effectAttempted = false;
            const operation: GatewayOperation = {
                id: randomUUID(),
                action,
                status: "running",
                startedAt: new Date().toISOString(),
            };
            if (desired) this.state.desired = desired;
            this.state.operations.push(operation);
            // No driver effect may happen before the durable intent exists.
            try {
                await this.persist();
            } catch (error) {
                // No effect was dispatched; expose only the previously committed state.
                this.state = previous;
                throw error;
            }
            try {
                await effect();
                operation.status = "succeeded";
            } catch (error) {
                if (error instanceof StatePersistenceError && this.effectAttempted) {
                    throw this.markUnknown(error, operation);
                }
                if (error instanceof StatePersistenceError && this.committedState) {
                    this.state = structuredClone(this.committedState);
                    // Keep the operation object attached to the restored durable snapshot.
                    this.state.operations[this.state.operations.length - 1] = operation;
                }
                operation.status = "failed";
                operation.error = error instanceof Error ? error.message : String(error);
                if (!(error instanceof StatePersistenceError)) this.state.actual = "failed";
                this.state.error = operation.error;
            }
            operation.finishedAt = new Date().toISOString();
            try {
                await this.persist();
            } catch (error) {
                throw this.markUnknown(error, operation);
            }
            if (
                operation.status === "succeeded" &&
                ["stop", "shutdown", "reconcile", "suspend"].includes(action)
            ) {
                this.storageUncertain = false;
            }
            return structuredClone(operation);
        });
    }

    private async startInstance(): Promise<void> {
        if (this.state.recoveryRequired) throw new Error("必须先核实前次实例是否已退出");
        if (this.instance) return;
        this.state.actual = "starting";
        this.state.error = undefined;
        // If start throws after spawning, the outcome remains unknown until reconciliation.
        this.state.recoveryRequired = true;
        await this.persist();
        this.effectAttempted = true;
        const instance = await this.options.driver.start();
        if (!instance?.id) throw new Error("网关握手缺少实例标识");
        this.instance = instance;
        this.state.instance = structuredClone(instance);
        this.state.actual = "running";
        this.state.recoveryRequired = false;
    }

    private async stopInstance(): Promise<void> {
        if (!this.instance) {
            if (this.state.recoveryRequired)
                throw new Error("旧实例退出状态未知，不能宣告停止成功");
            this.state.actual = "stopped";
            this.state.error = undefined;
            return;
        }
        this.state.actual = "stopping";
        this.state.recoveryRequired = true;
        await this.persist();
        this.effectAttempted = true;
        await this.options.driver.stop(this.instance);
        this.instance = undefined;
        this.state.instance = undefined;
        this.state.actual = "stopped";
        this.state.error = undefined;
        this.state.recoveryRequired = false;
        // Restart must persist the old instance's confirmed exit before creating another.
        await this.persist();
    }

    private assertInitialized(): void {
        if (!this.initialized) throw new Error("生命周期控制器尚未初始化");
    }

    private serial<T>(task: () => Promise<T>): Promise<T> {
        const result = this.queue.then(task);
        this.queue = result.catch(() => undefined); // Caller receives the error; keep the queue usable.
        return result;
    }

    private markUnknown(error: unknown, operation?: GatewayOperation): Error {
        this.storageUncertain = true;
        this.state.recoveryRequired = true;
        this.state.actual = "failed";
        this.state.error = `持久化失败，操作结果未知：${error instanceof Error ? error.message : String(error)}`;
        if (operation) {
            operation.status = "failed";
            operation.error = this.state.error;
            operation.finishedAt = new Date().toISOString();
        }
        return new StatePersistenceError(this.state.error, { cause: error });
    }

    private async persist(): Promise<void> {
        try {
            await this.writeState();
            this.committedState = this.status();
        } catch (error) {
            throw new StatePersistenceError("网关状态写入失败", { cause: error });
        }
    }

    private async writeState(): Promise<void> {
        const folder = dirname(this.options.statePath);
        await mkdir(folder, { recursive: true, mode: 0o700 });
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
            // Directory fsync is not supported by Windows; file flush + rename still apply.
            if (process.platform !== "win32") {
                const directory = await open(folder, "r");
                try {
                    await directory.sync();
                } finally {
                    await directory.close();
                }
            }
        } finally {
            await unlink(temporary).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            });
        }
    }
}

class StatePersistenceError extends Error {}

function parseState(value: unknown): GatewayControllerState {
    if (!value || typeof value !== "object") throw new Error("网关状态文件损坏");
    const state = value as GatewayControllerState;
    if (
        state.schemaVersion !== 1 ||
        !["running", "stopped"].includes(state.desired) ||
        !["starting", "running", "stopping", "stopped", "failed"].includes(state.actual) ||
        typeof state.recoveryRequired !== "boolean" ||
        !Array.isArray(state.operations) ||
        state.operations.some(
            operation =>
                !operation ||
                typeof operation.id !== "string" ||
                !["running", "succeeded", "failed"].includes(operation.status),
        ) ||
        (state.instance !== undefined && (!state.instance || typeof state.instance.id !== "string"))
    )
        throw new Error("网关状态文件格式不受支持或已损坏");
    return state;
}
