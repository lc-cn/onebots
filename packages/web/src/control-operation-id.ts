/** 用安全随机数生成 UUID v4；不依赖仅安全上下文提供的 randomUUID，也不降级到 Math.random。 */
export function createControlOperationId(): string {
    if (typeof globalThis.crypto?.getRandomValues !== "function")
        throw new Error("当前浏览器无法生成安全操作编号");
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
