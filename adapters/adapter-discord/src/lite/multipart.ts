import type { DiscordUpload } from "../media.js";
import type { CreateMessageBody } from "../types.js";

export interface DiscordMultipartBody {
    body: Uint8Array;
    contentType: string;
}

/** 构建可在 Node.js 原生 HTTPS 与 Fetch 环境复用的 multipart 请求体。 */
export function buildDiscordMultipart(
    payload: CreateMessageBody,
    files: DiscordUpload[],
    boundary = `onebots-${crypto.randomUUID()}`,
): DiscordMultipartBody {
    const encoder = new TextEncoder();
    const attachments = files.map((file, id) => ({
        id,
        filename: file.filename,
        ...(file.description ? { description: file.description } : {}),
    }));
    const parts: Uint8Array[] = [
        encoder.encode(
            `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\n` +
                `Content-Type: application/json\r\n\r\n${JSON.stringify({ ...payload, attachments })}\r\n`,
        ),
    ];
    files.forEach((file, index) => {
        parts.push(
            encoder.encode(
                `--${boundary}\r\nContent-Disposition: form-data; name="files[${index}]"; ` +
                    `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
            ),
            file.data,
            encoder.encode("\r\n"),
        );
    });
    parts.push(encoder.encode(`--${boundary}--\r\n`));
    return {
        body: concatBytes(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.byteLength;
    }
    return result;
}
