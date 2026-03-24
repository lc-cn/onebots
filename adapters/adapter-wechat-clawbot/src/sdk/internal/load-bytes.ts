import path from "node:path";
import type { InputFile } from "../protocol/chat-event.js";
import {
    guessMimeByPath,
    pickExtensionForMime,
    pickExtensionFromResponseHeader,
    scrubFilename,
} from "./mime-table.js";

export type ResolvedBlob = { buffer: Buffer; fileName: string; contentType: string };

function isRemoteUrl(s: string): boolean {
    return s.startsWith("http://") || s.startsWith("https://");
}

function isFileProto(s: string): boolean {
    return s.startsWith("file://");
}

/** 将用户输入统一为本地 Buffer + 元数据 */
export async function materializeUserSuppliedFile(
    input: InputFile,
    options?: { filename?: string; contentType?: string },
): Promise<ResolvedBlob> {
    if (typeof input === "string") {
        if (isRemoteUrl(input)) {
            const response = await fetch(input);
            if (!response.ok) {
                throw new Error(`远程资源拉取失败: ${response.status} ${response.statusText}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const ext = pickExtensionFromResponseHeader(response.headers.get("content-type"), input);
            const fileName = scrubFilename(options?.filename ?? `remote${ext}`);
            return {
                buffer,
                fileName,
                contentType: options?.contentType ?? guessMimeByPath(fileName),
            };
        }
        const filePath = isFileProto(input) ? new URL(input) : input;
        const { readFile } = await import("node:fs/promises");
        const buffer = Buffer.from(await readFile(filePath));
        const fileName = scrubFilename(options?.filename ?? path.basename(String(filePath)));
        return {
            buffer,
            fileName,
            contentType: options?.contentType ?? guessMimeByPath(fileName),
        };
    }

    if (input instanceof URL) {
        return materializeUserSuppliedFile(input.toString(), options);
    }

    if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
        const fileName = scrubFilename(
            options?.filename ??
                `buffer${pickExtensionForMime(options?.contentType ?? "application/octet-stream")}`,
        );
        return {
            buffer: Buffer.from(input),
            fileName,
            contentType: options?.contentType ?? guessMimeByPath(fileName),
        };
    }

    const fileName = scrubFilename(
        input.filename ??
            options?.filename ??
            `buffer${pickExtensionForMime(input.contentType ?? options?.contentType ?? "application/octet-stream")}`,
    );
    return {
        buffer: Buffer.from(input.source),
        fileName,
        contentType: input.contentType ?? options?.contentType ?? guessMimeByPath(fileName),
    };
}
