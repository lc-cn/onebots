import type { Client } from "@icqqjs/icqq";
import { ICQQError } from "./errors.js";

interface HeartbeatClient extends Omit<Client, "sendSsoHeartBeat" | "startSsoHeartBeat"> {
    sendSsoHeartBeat?: () => boolean | Promise<boolean>;
    startSsoHeartBeat?: () => void;
}

/** 包裹 ICQQ 内部未捕获的 SSO 心跳 Promise，并保持下一轮调度。 */
export function patchICQQSsoHeartbeat(
    client: Client,
    isCurrent: () => boolean,
    report: (error: ICQQError) => void,
): void {
    const heartbeat = client as HeartbeatClient;
    const original = heartbeat.sendSsoHeartBeat?.bind(heartbeat);
    if (!original) return;

    const recover = (error: unknown): false => {
        if (!isCurrent()) return false;
        report(ICQQError.wrap(error, "ICQQ_HEARTBEAT_FAILED", "heartbeat"));
        try {
            heartbeat.startSsoHeartBeat?.();
        } catch (restartError) {
            report(
                ICQQError.wrap(restartError, "ICQQ_HEARTBEAT_RESTART_FAILED", "heartbeat.restart"),
            );
        }
        return false;
    };

    heartbeat.sendSsoHeartBeat = () => {
        if (!isCurrent()) return false;
        try {
            const result = original();
            if (result && typeof (result as Promise<boolean>).then === "function")
                return (result as Promise<boolean>).catch(recover);
            return result;
        } catch (error) {
            return recover(error);
        }
    };
}
