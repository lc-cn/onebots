import type { BaseApp } from "@onebots/core";
import {
    isControlSendRequest,
    type ControlSendRequest,
    type ControlSendContext,
} from "@onebots/core/control";
import type { GatewaySendResult } from "./send-contracts.js";
export type GatewaySendOutcome =
    | { outcome: "succeeded"; result: GatewaySendResult }
    | { outcome: "rejected" | "unknown" };
/** 只调用已存在在线账号；关闭IPC不能宣称平台SDK已取消。 */
export class GatewaySendExecutor {
    private active = 0;
    private closed = false;
    constructor(
        private readonly app: Pick<BaseApp, "adapters">,
        private readonly context: ControlSendContext,
    ) {}
    async send(request: ControlSendRequest): Promise<GatewaySendOutcome> {
        if (
            this.closed ||
            !isControlSendRequest(request) ||
            request.expected.gatewayInstanceId !== this.context.gatewayInstanceId ||
            request.expected.configVersion !== this.context.configVersion ||
            this.active >= 8
        )
            return { outcome: "rejected" };
        const separator = request.account.indexOf("/");
        const platform = request.account.slice(0, separator),
            id = request.account.slice(separator + 1);
        const adapter = [...this.app.adapters].find(([name]) => String(name) === platform)?.[1];
        const account = adapter?.accounts.get(id);
        if (!adapter || !account || account.status !== "online") return { outcome: "rejected" };
        this.active++;
        try {
            const result = await adapter.sendMessage(id, {
                scene_type: request.targetType,
                scene_id: adapter.resolveId(request.targetId),
                message: [{ type: "text", data: { text: request.message } }],
            });
            if (!result || typeof result !== "object" || !Object.hasOwn(result, "message_id"))
                return { outcome: "unknown" };
            const messageId = result.message_id;
            if (messageId === null) return { outcome: "succeeded", result: { messageId: null } };
            if (
                !messageId ||
                typeof messageId !== "object" ||
                typeof messageId.string !== "string" ||
                Buffer.byteLength(messageId.string) > 32768
            )
                return { outcome: "unknown" };
            return { outcome: "succeeded", result: { messageId: messageId.string } };
        } catch {
            return { outcome: "unknown" };
        } finally {
            this.active--;
        }
    }
    close(): void {
        this.closed = true;
    }
}
