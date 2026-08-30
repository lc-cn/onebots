import { randomBytes } from "node:crypto";

export interface ZulipMultipartBody {
    body: Buffer;
    contentType: string;
}

/** 构建 Zulip 上传端点共用的单文件 multipart 请求体。 */
export function buildZulipMultipart(
    field: string,
    data: Uint8Array,
    filename: string,
    mimeType = "application/octet-stream",
): ZulipMultipartBody {
    const boundary = `----onebots-${randomBytes(12).toString("hex")}`;
    const prefix = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${escapeFilename(filename)}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
        body: Buffer.concat([prefix, Buffer.from(data), suffix]),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

function escapeFilename(filename: string): string {
    return filename.replace(/["\r\n]/g, "_");
}
