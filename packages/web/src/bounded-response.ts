/** 响应正文超过调用方允许的字节上限。 */
export class ResponseBodyTooLargeError extends Error {
    constructor(limitBytes: number) {
        super(`响应正文超过 ${formatByteLimit(limitBytes)} 上限`);
        this.name = "ResponseBodyTooLargeError";
    }
}

/** 按实际解码前字节数限制 Fetch 响应，并在超限时取消流。 */
export async function readBoundedResponseBody(
    response: Response,
    limitBytes: number,
): Promise<string> {
    if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
        throw new RangeError("响应正文上限必须是正安全整数");
    }

    const contentLength = response.headers.get("content-length");
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > limitBytes) {
        await cancelBody(response.body);
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
            await cancelReader(reader);
            throw new ResponseBodyTooLargeError(limitBytes);
        }
        body += decoder.decode(chunk.value, { stream: true });
    }
}

/** 读取有界 JSON 响应；返回值保持 unknown，交由调用方验证契约。 */
export async function readBoundedJsonResponse(
    response: Response,
    limitBytes: number,
): Promise<unknown> {
    return JSON.parse(await readBoundedResponseBody(response, limitBytes)) as unknown;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) return;
    await Promise.allSettled([body.cancel()]);
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    await Promise.allSettled([reader.cancel()]);
}

function formatByteLimit(bytes: number): string {
    if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
    if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
    return `${bytes} 字节`;
}
