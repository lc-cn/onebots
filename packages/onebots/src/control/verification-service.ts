import { parseGatewayVerificationCommand } from "../gateway/verification-command.js";
import {
    isGatewayVerificationReply,
    type GatewayVerificationReply,
} from "../gateway/verification-contracts.js";
import type { GatewayVerificationOperation } from "./gateway-verification-client.js";
import { GatewayRequestError } from "./gateway-request-client.js";
import { ControlVerificationStore } from "./verification-store.js";
import {
    ControlVerificationError,
    projectVerification,
    verificationHash,
    type VerificationRecord,
} from "./verification-record.js";

interface Context {
    gatewayInstanceId: string;
    configVersion: string;
}
export interface ControlVerificationServiceOptions {
    directory: string;
    currentContext(): Context | undefined;
    forward(
        context: Context,
        operation: GatewayVerificationOperation,
    ): Promise<GatewayVerificationReply>;
    timeoutMs?: number;
    acknowledgeWhileStopped?(commit: () => Operation): Promise<Operation>;
}
type Operation = ReturnType<typeof projectVerification>;
interface Pending {
    owner: string;
    digest: string;
    promise: Promise<Operation>;
}
/** 单一 manager 工作区锁内使用；答案只保留到当前派发，回执不保存答案。 */
export class ControlVerificationService {
    private readonly store: ControlVerificationStore;
    private readonly pending = new Map<string, Pending>();
    private closed = false;
    private activeForwards = 0;
    private readonly timeoutMs: number;
    constructor(private readonly options: ControlVerificationServiceOptions) {
        this.timeoutMs = options.timeoutMs ?? 30000;
        if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000)
            throw new Error("账号验证请求期限无效");
        this.store = new ControlVerificationStore(options.directory);
    }
    health() {
        return this.store.health();
    }
    private context(): Context {
        const value = this.options.currentContext();
        if (this.closed || !value) throw new ControlVerificationError(503);
        return { ...value };
    }
    private current(expected: Context): boolean {
        try {
            const value = this.context();
            return (
                value.gatewayInstanceId === expected.gatewayInstanceId &&
                value.configVersion === expected.configVersion
            );
        } catch {
            return false; /* 切换或停止时拒绝把旧实例结果当作当前结果。 */
        }
    }
    async snapshot() {
        const context = this.context();
        const reply = await this.forward(context, { action: "list" });
        if (
            !this.current(context) ||
            !isGatewayVerificationReply(reply) ||
            reply.action !== "list" ||
            reply.outcome !== "succeeded" ||
            reply.gatewayInstanceId !== context.gatewayInstanceId ||
            reply.configVersion !== context.configVersion
        )
            throw new ControlVerificationError(503);
        return { ...context, challenges: reply.challenges };
    }
    operation(owner: string, id: string, localRecovery = false): Operation {
        if (!verificationHash(owner)) throw new ControlVerificationError(400);
        const record = this.store.read(id);
        if (!localRecovery && record.ownerHash !== owner) throw new ControlVerificationError(404);
        return projectVerification(record);
    }
    async reconcile(
        owner: string,
        id: string,
        authorized: () => boolean = () => true,
        localRecovery = false,
    ): Promise<Operation> {
        if (this.closed || !authorized()) throw new ControlVerificationError(403);
        this.operation(owner, id, localRecovery);
        const record = this.store.read(id);
        if (record.status !== "unknown" || record.resolution || record.acknowledgement)
            return projectVerification(record);
        if (!this.store.health().available) throw new ControlVerificationError(503);
        const context = {
            gatewayInstanceId: record.gatewayInstanceId,
            configVersion: record.configVersion,
        };
        // 另一个进程无法证明原SDK调用结果；不把不存在的回执当作未执行。
        if (!this.current(context)) return projectVerification(record);
        const reply = await this.forward(
            context,
            {
                action: "query",
                operationId: id,
                challengeId: record.challengeId,
                verificationAction: record.action,
            },
            authorized,
        );
        if (!authorized()) throw new ControlVerificationError(403);
        if (!this.current(context)) return projectVerification(record);
        if (
            !isGatewayVerificationReply(reply) ||
            reply.action !== "query" ||
            reply.outcome !== "succeeded" ||
            reply.operationId !== id ||
            reply.challengeId !== record.challengeId ||
            reply.verificationAction !== record.action ||
            reply.gatewayInstanceId !== context.gatewayInstanceId ||
            reply.configVersion !== context.configVersion
        )
            throw new ControlVerificationError(503);
        return reply.state === "succeeded" || reply.state === "rejected"
            ? projectVerification(this.store.resolve(record, reply.state))
            : projectVerification(record);
    }
    async acknowledge(
        owner: string,
        id: string,
        acceptUnknownOutcome: boolean,
        authorized: () => boolean = () => true,
        localRecovery = false,
    ): Promise<Operation> {
        const check = () => {
            if (this.closed || !authorized()) throw new ControlVerificationError(403);
            if (acceptUnknownOutcome !== true) throw new ControlVerificationError(400);
            this.operation(owner, id, localRecovery);
        };
        check();
        const record = this.store.read(id);
        if (record.status !== "unknown" || record.resolution)
            throw new ControlVerificationError(409);
        if (record.acknowledgement) return projectVerification(record);
        if (!this.options.acknowledgeWhileStopped) throw new ControlVerificationError(503);
        return this.options.acknowledgeWhileStopped(() => {
            check();
            if (this.pending.has(id)) throw new ControlVerificationError(409);
            return projectVerification(this.store.acknowledge(record, owner));
        });
    }
    execute(
        owner: string,
        input: unknown,
        authorized: () => boolean = () => true,
    ): Promise<Operation> {
        try {
            if (this.closed || !authorized()) throw new ControlVerificationError(403);
            if (!verificationHash(owner)) throw new ControlVerificationError(400);
            const command = parseGatewayVerificationCommand(input);
            if (!command) throw new ControlVerificationError(400);
            const digest = this.store.digest(command);
            const pending = this.pending.get(command.operationId);
            if (pending) {
                if (pending.owner !== owner) throw new ControlVerificationError(404);
                if (pending.digest !== digest) throw new ControlVerificationError(409);
                return pending.promise;
            }
            if (this.pending.size >= 32) throw new ControlVerificationError(429);
            const promise = Promise.resolve().then(async () => {
                let existing: VerificationRecord | undefined;
                try {
                    existing = this.store.read(command.operationId);
                } catch (error) {
                    if (!(error instanceof ControlVerificationError) || error.httpStatus !== 404)
                        throw error;
                }
                if (existing) {
                    if (existing.ownerHash !== owner) throw new ControlVerificationError(404);
                    if (existing.requestDigest !== digest) throw new ControlVerificationError(409);
                    return projectVerification(existing);
                }
                if (!this.store.health().available) throw new ControlVerificationError(503);
                if (!this.current(command.expected)) throw new ControlVerificationError(409);
                const snapshot = await this.snapshot();
                if (
                    snapshot.gatewayInstanceId !== command.expected.gatewayInstanceId ||
                    snapshot.configVersion !== command.expected.configVersion
                )
                    throw new ControlVerificationError(409);
                const challenge = snapshot.challenges.find(
                    value => value.id === command.challengeId,
                );
                if (!challenge || challenge.expiresAt <= Date.now())
                    throw new ControlVerificationError(409);
                if (!authorized()) throw new ControlVerificationError(403);
                if (!this.current(command.expected)) throw new ControlVerificationError(409);
                const accountHash = this.store.accountHash(
                    challenge.request.platform,
                    challenge.request.account_id,
                );
                if (this.store.hasUncertainAccount(accountHash))
                    throw new ControlVerificationError(409);
                const record: VerificationRecord = {
                    schemaVersion: 1,
                    id: command.operationId,
                    ownerHash: owner,
                    requestDigest: digest,
                    accountHash,
                    challengeId: command.challengeId,
                    ...command.expected,
                    action: command.action,
                    status: "running",
                    startedAt: new Date().toISOString(),
                };
                this.store.create(record);
                let status: VerificationRecord["status"] = "unknown";
                try {
                    if (!authorized() || !this.current(command.expected)) status = "rejected";
                    else {
                        const reply = await this.forward(
                            command.expected,
                            { action: "execute", command },
                            authorized,
                        );
                        if (
                            !isGatewayVerificationReply(reply) ||
                            reply.action !== "execute" ||
                            reply.operationId !== command.operationId ||
                            reply.gatewayInstanceId !== command.expected.gatewayInstanceId ||
                            reply.configVersion !== command.expected.configVersion
                        )
                            throw new Error("验证回执无效");
                        status = this.current(command.expected) ? reply.outcome : "unknown";
                    }
                } catch (error) {
                    status =
                        error instanceof GatewayRequestError && error.outcome === "rejected"
                            ? "rejected"
                            : "unknown";
                }
                const completed = { ...record, status, finishedAt: new Date().toISOString() };
                this.store.finish(completed);
                return projectVerification(completed);
            });
            this.pending.set(command.operationId, { owner, digest, promise });
            void promise.then(
                () => this.pending.delete(command.operationId),
                () => this.pending.delete(command.operationId),
            );
            return promise;
        } catch (error) {
            return Promise.reject(error);
        }
    }
    private async forward(
        context: Context,
        operation: GatewayVerificationOperation,
        authorized: () => boolean = () => true,
    ): Promise<GatewayVerificationReply> {
        if (this.activeForwards >= 8) throw new GatewayRequestError("rejected", "验证请求已达上限");
        this.activeForwards++;
        const actual = Promise.resolve().then(() => {
            if (!authorized() || !this.current(context))
                throw new GatewayRequestError("rejected", "验证派发条件已失效");
            return this.options.forward(context, operation);
        });
        // 超时只是失去结果，不能释放仍在运行的远端请求容量。
        void actual.then(
            () => this.activeForwards--,
            () => this.activeForwards--,
        );
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                actual,
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () => reject(new GatewayRequestError("unknown", "验证结果未知")),
                        this.timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
    async close(): Promise<void> {
        this.closed = true;
        await Promise.allSettled([...this.pending.values()].map(item => item.promise));
    }
}
