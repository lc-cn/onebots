export const DEFAULT_MAX_INGRESS_BYTES = 1024 * 1024;

export class PayloadTooLargeError extends Error {
    constructor() {
        super("事件载荷过大");
        this.name = "PayloadTooLargeError";
    }
}

function assertPayloadSize(byteLength: number): void {
    if (byteLength > DEFAULT_MAX_INGRESS_BYTES) throw new PayloadTooLargeError();
}

/**
 * 将宿主或传输层收到的单个 JSON 帧解码为协议原始事件。
 *
 * 这里集中维护支持的二进制形态和 1 MiB 上限，避免各 Receiver 对同一输入产生不同语义。
 */
export function decodeIngressPayload(data: unknown): unknown {
    if (typeof data === "string") {
        assertPayloadSize(Buffer.byteLength(data));
        return JSON.parse(data) as unknown;
    }
    if (Buffer.isBuffer(data)) {
        assertPayloadSize(data.byteLength);
        return JSON.parse(data.toString("utf8")) as unknown;
    }
    if (data instanceof ArrayBuffer) {
        assertPayloadSize(data.byteLength);
        return JSON.parse(Buffer.from(data).toString("utf8")) as unknown;
    }
    if (ArrayBuffer.isView(data)) {
        assertPayloadSize(data.byteLength);
        return JSON.parse(
            Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"),
        ) as unknown;
    }
    if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
        assertPayloadSize(data.reduce((total, item) => total + item.byteLength, 0));
        return JSON.parse(Buffer.concat(data).toString("utf8")) as unknown;
    }
    throw new TypeError("事件载荷必须是 JSON 文本或二进制数据");
}

export function assertIngressObjectSize(value: unknown): void {
    assertPayloadSize(Buffer.byteLength(JSON.stringify(value)));
}
