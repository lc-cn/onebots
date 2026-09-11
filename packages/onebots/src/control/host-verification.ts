import path from "node:path";
import type { ControlAuth } from "./auth.js";
import type { NodeGatewayDriver } from "./gateway-driver.js";
import type { GenerationActivationController } from "./generation-activation.js";
import { ControlVerificationHttp } from "./verification-http.js";
import { ControlVerificationError } from "./verification-record.js";
import { serviceMigrationStatus } from "./service-migration-api.js";
import { controlDirectory } from "./workspace.js";
import type { PersistedOperationObserver } from "../persisted-operation-observer.js";

interface StoppedVerificationOptions {
    lifecycle: GenerationActivationController;
    available(): boolean;
}

/** 只接受已停机后的风险确认；复用生命周期队列，不停止网关，也不重发验证。 */
export function acknowledgeVerificationWhileStopped<T>(
    options: StoppedVerificationOptions,
    commit: () => T,
): Promise<T> {
    return options.lifecycle.runConfigurationTransaction(async port => {
        const state = options.lifecycle.status();
        if (
            !options.available() ||
            state.recoveryRequired ||
            state.gateway.recoveryRequired ||
            state.gateway.desired !== "stopped" ||
            state.gateway.actual !== "stopped" ||
            state.gateway.instance ||
            port.hasLiveChildren()
        )
            throw new ControlVerificationError(409);
        // 证明与同步持久化之间不能 await，否则启停或关闭可能改变已核对的状态。
        return commit();
    });
}

export function createHostVerification(
    options: StoppedVerificationOptions & {
        workspace: string;
        auth: ControlAuth;
        driver: Pick<NodeGatewayDriver, "verificationContext" | "verification">;
        currentGateway(): string | undefined;
        onOperation?: PersistedOperationObserver;
    },
): ControlVerificationHttp {
    const whileStopped = <T>(commit: () => T) =>
        acknowledgeVerificationWhileStopped(
            {
                lifecycle: options.lifecycle,
                available: () =>
                    options.available() && !serviceMigrationStatus(options.workspace).pending,
            },
            commit,
        );
    return new ControlVerificationHttp(
        {
            directory: path.join(controlDirectory(options.workspace), "verification"),
            currentContext: () => {
                const id = options.currentGateway();
                return id ? options.driver.verificationContext(id) : undefined;
            },
            forward: (context, operation) =>
                options.driver.verification(context.gatewayInstanceId, operation),
            acknowledgeWhileStopped: whileStopped,
            abandonWhileStopped: whileStopped,
            onOperation: options.onOperation,
        },
        options.auth,
    );
}
