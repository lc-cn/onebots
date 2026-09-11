/** 发送控制契约不依赖平台插件；控制服务绑定实际运行的网关快照。 */
export interface ControlSendContext {
    gatewayInstanceId: string;
    configVersion: string;
}

export interface ControlSendRequest {
    id: string;
    expected: ControlSendContext;
    account: string;
    targetType: "private" | "group" | "channel";
    targetId: string | number;
    message: string;
}

/** unknown 表示可能已经发出，不能通过重放操作来恢复。 */
export interface ControlSendOperation extends ControlSendContext {
    id: string;
    status: "running" | "succeeded" | "rejected" | "unknown";
    startedAt: string;
    finishedAt?: string;
    messageId?: string | null;
}

const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
        Reflect.ownKeys(value).length === keys.length &&
        keys.every(key => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor?.enumerable && "value" in descriptor;
        }),
    );
}

export function isControlSendContext(value: unknown): value is ControlSendContext {
    return (
        closed(value, ["gatewayInstanceId", "configVersion"]) &&
        uuid(value.gatewayInstanceId) &&
        typeof value.configVersion === "string" &&
        /^[0-9a-f]{64}$/.test(value.configVersion)
    );
}

export function isControlSendOperation(value: unknown): value is ControlSendOperation {
    if (!value || typeof value !== "object") return false;
    const extras = ["finishedAt", "messageId"].filter(key => Object.hasOwn(value, key));
    if (
        !closed(value, [
            "id",
            "gatewayInstanceId",
            "configVersion",
            "status",
            "startedAt",
            ...extras,
        ]) ||
        !uuid(value.id) ||
        !isControlSendContext({
            gatewayInstanceId: value.gatewayInstanceId,
            configVersion: value.configVersion,
        }) ||
        typeof value.status !== "string" ||
        !["running", "succeeded", "rejected", "unknown"].includes(value.status)
    )
        return false;
    const isoDate = (v: unknown): v is string =>
        typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    if (!isoDate(value.startedAt)) return false;
    if (value.status === "running") return extras.length === 0;
    if (!isoDate(value.finishedAt) || value.finishedAt < value.startedAt) return false;
    if (value.status !== "succeeded") return !Object.hasOwn(value, "messageId");
    return (
        Object.hasOwn(value, "messageId") &&
        (value.messageId === null ||
            (typeof value.messageId === "string" &&
                value.messageId.length <= 4096 &&
                !/[\u0000-\u001f\u007f]/.test(value.messageId)))
    );
}

/** 保留数字与字符串的区别，不把数字形字符串、前导零或账号后缀强制转换。 */
export function isControlSendRequest(value: unknown): value is ControlSendRequest {
    if (!closed(value, ["id", "expected", "account", "targetType", "targetId", "message"]))
        return false;
    if (!uuid(value.id) || !isControlSendContext(value.expected)) return false;
    if (
        typeof value.account !== "string" ||
        value.account.length > 1024 ||
        value.account.indexOf("/") < 1 ||
        value.account.endsWith("/") ||
        /[\u0000-\u001f\u007f]/.test(value.account)
    )
        return false;
    if (
        typeof value.targetType !== "string" ||
        !["private", "group", "channel"].includes(value.targetType)
    )
        return false;
    if (typeof value.targetId === "number") {
        if (!Number.isSafeInteger(value.targetId) || value.targetId < 0) return false;
    } else if (
        typeof value.targetId !== "string" ||
        !value.targetId ||
        value.targetId.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(value.targetId)
    )
        return false;
    if (typeof value.message !== "string" || !value.message) return false;
    const encoder = new TextEncoder();
    return (
        encoder.encode(value.message).length <= 32768 &&
        encoder.encode(JSON.stringify(value)).length <= 64000
    );
}
