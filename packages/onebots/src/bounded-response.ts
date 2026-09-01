/** 响应正文超过调用方允许的字节上限。 */
export class ResponseBodyTooLargeError extends Error {
    constructor(limitBytes: number) {
        super(`响应正文超过 ${formatByteLimit(limitBytes)} 上限`);
    }
}

/** 按实际解码前字节数限制 Fetch 响应，并在超限时取消流。 */
export async function readBoundedResponseBody(
    response: Response,
    limitBytes: number,
): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
        await response.body?.cancel();
        throw new ResponseBodyTooLargeError(limitBytes);
    }
    if (!response.body) return "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let body = "";
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) return body + decoder.decode();
        bytesRead += chunk.value.byteLength;
        if (bytesRead > limitBytes) {
            await reader.cancel();
            throw new ResponseBodyTooLargeError(limitBytes);
        }
        body += decoder.decode(chunk.value, { stream: true });
    }
}

function formatByteLimit(bytes: number): string {
    if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
    if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
    return `${bytes} 字节`;
}
