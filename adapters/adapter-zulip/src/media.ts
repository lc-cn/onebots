import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { CommonTypes } from "onebots";
import { ZulipError } from "./errors.js";

export interface ZulipUploadSource {
    data: Uint8Array;
    filename: string;
    mimeType?: string;
}

/** 读取 URL、路径或 Base64 消息段；远程 URL 可直接作为 Markdown 资源而无需复制上传。 */
export async function resolveZulipMedia(
    segment: CommonTypes.Segment,
): Promise<{ directUrl?: string; upload?: ZulipUploadSource }> {
    const name = stringValue(segment.data.name || segment.data.filename);
    const url = stringValue(segment.data.url);
    if (url && /^https?:\/\//i.test(url)) return { directUrl: url };

    const path = stringValue(segment.data.path || segment.data.file);
    if (path && !/^https?:\/\//i.test(path) && !/^base64:/i.test(path)) {
        try {
            return {
                upload: {
                    data: await readFile(path),
                    filename: name || basename(path),
                    mimeType: stringValue(segment.data.mime_type) || undefined,
                },
            };
        } catch (error) {
            throw new ZulipError(`无法读取 Zulip 上传文件 ${path}`, {
                code: "ZULIP_FILE_READ_FAILED",
                cause: error,
            });
        }
    }

    const encoded =
        stringValue(segment.data.data) ||
        (path.startsWith("base64:") ? path.slice("base64:".length) : "");
    if (encoded) {
        const data = Buffer.from(encoded, "base64");
        if (!data.length) {
            throw new ZulipError("Zulip Base64 文件为空", { code: "ZULIP_EMPTY_UPLOAD" });
        }
        return {
            upload: {
                data,
                filename: name || `${segment.type}.bin`,
                mimeType: stringValue(segment.data.mime_type) || undefined,
            },
        };
    }
    throw new ZulipError(`${segment.type} 消息段缺少 url、path/file 或 data`, {
        code: "ZULIP_INVALID_MEDIA",
        details: segment,
    });
}

/** 读取标准 upload_file 参数。 */
export async function loadZulipUpload(params: {
    name: string;
    url?: string;
    path?: string;
    data?: string;
}): Promise<ZulipUploadSource> {
    if (params.path) {
        return {
            data: await readFile(params.path),
            filename: params.name || basename(params.path),
        };
    }
    if (params.data) return { data: Buffer.from(params.data, "base64"), filename: params.name };
    if (params.url) {
        const response = await fetch(params.url);
        if (!response.ok) {
            throw new ZulipError(`下载待上传文件失败: HTTP ${response.status}`, {
                code: "ZULIP_UPLOAD_DOWNLOAD_FAILED",
                status: response.status,
            });
        }
        return {
            data: new Uint8Array(await response.arrayBuffer()),
            filename: params.name,
            mimeType: response.headers.get("content-type") || undefined,
        };
    }
    throw new ZulipError("upload_file 需要 path、data 或 url", {
        code: "ZULIP_INVALID_UPLOAD",
    });
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}
