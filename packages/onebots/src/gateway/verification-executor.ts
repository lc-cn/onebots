import { createHmac, randomBytes } from "node:crypto";
import type { BaseApp } from "@onebots/core";
import { GatewayVerificationStore } from "./verification-store.js";
import {
    parseGatewayVerificationCommand,
    permitsVerificationInput,
    type GatewayVerificationCommand,
} from "./verification-command.js";
export {
    isGatewayVerificationCommand,
    type GatewayVerificationCommand,
} from "./verification-command.js";
export type GatewayVerificationOutcome = { outcome: "succeeded" | "rejected" | "unknown" };
interface Receipt {
    digest: string;
    result: Promise<GatewayVerificationOutcome>;
}
/** 本进程防重放；持久化派发意图与跨重启恢复由 manager 持有。 */
export class GatewayVerificationExecutor {
    private readonly key = randomBytes(32);
    private readonly receipts = new Map<string, Receipt>();
    private readonly busy = new Set<string>();
    private closed = false;
    constructor(
        private readonly app: Pick<BaseApp, "adapters">,
        private readonly store: GatewayVerificationStore,
        private readonly context: GatewayVerificationCommand["expected"],
    ) {}
    execute(input: GatewayVerificationCommand): Promise<GatewayVerificationOutcome> {
        const command = parseGatewayVerificationCommand(input);
        if (this.closed || !command) return Promise.resolve({ outcome: "rejected" });
        const digest = createHmac("sha256", this.key).update(JSON.stringify(command)).digest("hex");
        const previous = this.receipts.get(command.operationId);
        if (previous)
            return previous.digest === digest
                ? previous.result.then(result => ({ ...result }))
                : Promise.resolve({ outcome: "rejected" });
        if (
            this.receipts.size >= 1024 ||
            command.expected.gatewayInstanceId !== this.context.gatewayInstanceId ||
            command.expected.configVersion !== this.context.configVersion
        )
            return Promise.resolve({ outcome: "rejected" });
        const challenge = this.store.get(command.challengeId);
        if (!challenge || !permitsVerificationInput(challenge.request, command))
            return Promise.resolve({ outcome: "rejected" });
        const { platform, account_id: accountId, type } = challenge.request;
        const adapter = [...this.app.adapters].find(([name]) => String(name) === platform)?.[1];
        const account = adapter?.accounts.get(accountId);
        const accountKey = JSON.stringify([platform, accountId]);
        const method =
            command.action === "submit" ? adapter?.submitVerification : adapter?.requestSmsCode;
        if (!adapter || !account || typeof method !== "function" || this.busy.has(accountKey))
            return Promise.resolve({ outcome: "rejected" });
        const isCurrent = () =>
            [...this.app.adapters].find(([name]) => String(name) === platform)?.[1] === adapter &&
            adapter.accounts.get(accountId) === account;
        this.busy.add(accountKey);
        // 在 SDK 调用前登记 receipt，连同步重入也不能再次派发。
        const result = Promise.resolve().then(async (): Promise<GatewayVerificationOutcome> => {
            try {
                if (this.closed || !this.store.get(command.challengeId) || !isCurrent())
                    return { outcome: "rejected" };
                if (command.action === "submit")
                    await adapter.submitVerification!(accountId, type, command.data ?? {});
                else await adapter.requestSmsCode!(accountId);
                if (this.closed || !isCurrent()) return { outcome: "unknown" };
                if (command.action === "submit") this.store.complete(command.challengeId);
                return { outcome: "succeeded" };
            } catch {
                // SDK 可能已消耗验证码或发出短信，不能将异常声称为未执行。
                return { outcome: "unknown" };
            } finally {
                this.busy.delete(accountKey);
            }
        });
        this.receipts.set(command.operationId, { digest, result });
        return result.then(value => ({ ...value }));
    }
    close(): void {
        this.closed = true;
    }
}
