/** Discord 待上传附件；source 支持 HTTPS、data URL、base64:// 和 Node.js 本地路径。 */
export interface DiscordFileInput {
    source: string;
    filename?: string;
    contentType?: string;
    description?: string;
}

/** 已物化、可直接写入 multipart 的 Discord 附件。 */
export interface DiscordUpload {
    data: Uint8Array;
    filename: string;
    contentType: string;
    description?: string;
}

/** 将统一媒体来源收敛为字节与可信元数据。 */
export async function materializeDiscordFile(input: DiscordFileInput): Promise<DiscordUpload> {
    const source = input.source;
    let data: Uint8Array;
    let inferredName = "attachment.bin";
    let inferredType: string | undefined;

    if (source.startsWith("base64://")) {
        data = decodeBase64(source.slice("base64://".length));
    } else if (source.startsWith("data:")) {
        const parsed = parseDataUrl(source);
        data = parsed.data;
        inferredType = parsed.contentType;
    } else if (/^https?:\/\//u.test(source)) {
        const url = new URL(source);
        if (url.username || url.password) throw invalidSource("远程媒体 URL 不能包含凭据");
        const response = await fetch(url);
        if (!response.ok) {
            throw invalidSource(`远程媒体下载失败: HTTP ${response.status}`);
        }
        data = new Uint8Array(await response.arrayBuffer());
        inferredName = lastPathComponent(url.pathname) || inferredName;
        inferredType = response.headers.get("content-type")?.split(";", 1)[0];
    } else {
        if (!isNode()) throw invalidSource("当前运行环境不支持读取本地媒体路径");
        const { readFile } = await import("node:fs/promises");
        data = await readFile(source.startsWith("file://") ? new URL(source) : source);
        inferredName = lastPathComponent(source) || inferredName;
    }

    if (!data.byteLength) throw invalidSource("附件不能为空");
    const filename = safeFilename(input.filename || inferredName);
    const description = optionalDescription(input.description);
    return {
        data,
        filename,
        contentType: safeContentType(
            input.contentType || inferredType || mimeFromFilename(filename),
        ),
        ...(description ? { description } : {}),
    };
}

function parseDataUrl(source: string): { data: Uint8Array; contentType?: string } {
    const comma = source.indexOf(",");
    if (comma < 0) throw invalidSource("data URL 缺少数据部分");
    const metadata = source.slice(5, comma);
    if (!metadata.endsWith(";base64")) throw invalidSource("data URL 必须使用 Base64 编码");
    return {
        data: decodeBase64(source.slice(comma + 1)),
        contentType: metadata.slice(0, -7) || undefined,
    };
}

function decodeBase64(value: string): Uint8Array {
    const normalized = value.replace(/\s/gu, "");
    if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
        throw invalidSource("Base64 数据无效");
    }
    try {
        const binary = atob(normalized);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
        throw invalidSource("Base64 数据无效");
    }
}

function safeFilename(value: string): string {
    const filename = lastPathComponent(value).replace(/[\u0000-\u001f\u007f"\\]/gu, "_");
    return filename.slice(0, 255) || "attachment.bin";
}

function optionalDescription(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (value.length > 1024) throw invalidSource("附件描述不能超过 1024 个字符");
    return value;
}

function safeContentType(value: string): string {
    if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/u.test(value)) {
        throw invalidSource("附件 content type 无效");
    }
    return value;
}

function lastPathComponent(value: string): string {
    return value.replace(/\\/gu, "/").split("/").filter(Boolean).at(-1) || "";
}

function mimeFromFilename(filename: string): string {
    const extension = filename.toLowerCase().split(".").at(-1);
    return (
        {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            mp3: "audio/mpeg",
            ogg: "audio/ogg",
            wav: "audio/wav",
            mp4: "video/mp4",
            webm: "video/webm",
            pdf: "application/pdf",
            txt: "text/plain",
        }[extension || ""] || "application/octet-stream"
    );
}

function isNode(): boolean {
    return typeof process !== "undefined" && Boolean(process.versions?.node);
}

function invalidSource(message: string): Error {
    return new Error(`Discord 媒体来源无效: ${message}`);
}
