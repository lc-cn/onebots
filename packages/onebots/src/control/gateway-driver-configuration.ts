import type { ChildProcess } from "node:child_process";
import type { ControlSendContext } from "@onebots/core/control";
import type {
    GatewayConfigurationInput,
    GatewayConfigurationResult,
} from "../gateway/configuration-contracts.js";
import { requestGatewayConfiguration } from "./gateway-configuration-client.js";
import { GatewayRequestError, type GatewayRequestClient } from "./gateway-request-client.js";

interface ConfigurationChild {
    child: ChildProcess;
    stopping: boolean;
    exited: boolean;
    configurationVersion?: string;
    verificationConfig?: string;
    sendContext?: ControlSendContext;
    requests?: GatewayRequestClient;
}
export function runtimeContext(managed: ConfigurationChild | undefined, id: string) {
    return managed &&
        !managed.stopping &&
        !managed.exited &&
        managed.child.exitCode === null &&
        managed.child.signalCode === null &&
        managed.child.connected &&
        managed.configurationVersion
        ? { gatewayInstanceId: id, configVersion: managed.configurationVersion }
        : undefined;
}
function synchronize(managed: ConfigurationChild, result: GatewayConfigurationResult): void {
    managed.configurationVersion = result.configVersion;
    if (managed.sendContext) managed.sendContext.configVersion = result.configVersion;
    if (managed.verificationConfig) managed.verificationConfig = result.configVersion;
}
export async function applyRuntimeConfiguration(
    managed: ConfigurationChild | undefined,
    controlInstanceId: string,
    input: GatewayConfigurationInput,
): Promise<GatewayConfigurationResult> {
    const context = runtimeContext(managed, input.expected.gatewayInstanceId);
    if (!context || !managed?.requests || context.configVersion !== input.expected.configVersion)
        throw new GatewayRequestError("rejected", "网关配置上下文已变化，未派发");
    const result = await requestGatewayConfiguration(
        managed.requests,
        {
            protocolVersion: 1,
            controlInstanceId,
            gatewayInstanceId: input.expected.gatewayInstanceId,
        },
        {
            action: "apply",
            operationId: input.id,
            expectedConfigVersion: input.expected.configVersion,
            nextConfigVersion: input.nextConfigVersion,
            configPath: input.configPath,
        },
    );
    if (result.status === "applied") {
        if (result.configVersion !== input.nextConfigVersion)
            throw new GatewayRequestError("unknown", "网关配置回执身份不一致");
        synchronize(managed, result);
    }
    return result;
}
export async function queryRuntimeConfiguration(
    managed: ConfigurationChild | undefined,
    controlInstanceId: string,
    input: { id: string; expected: { gatewayInstanceId: string; configVersion: string } },
): Promise<GatewayConfigurationResult> {
    if (!managed?.requests || managed.stopping || managed.exited)
        throw new GatewayRequestError("unknown", "原网关不可用，配置结果未知");
    const result = await requestGatewayConfiguration(
        managed.requests,
        {
            protocolVersion: 1,
            controlInstanceId,
            gatewayInstanceId: input.expected.gatewayInstanceId,
        },
        {
            action: "query",
            operationId: input.id,
            expectedConfigVersion: input.expected.configVersion,
        },
    );
    // 迟到原回执只能推进仍停留在原身份的父进程，不能回退后续成功批次的版本。
    if (
        result.status === "applied" &&
        managed.configurationVersion === input.expected.configVersion
    )
        synchronize(managed, result);
    return result;
}
