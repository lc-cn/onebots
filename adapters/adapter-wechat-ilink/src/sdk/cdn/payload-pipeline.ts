import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { IlinkJsonTransport } from "../transport/ilink-json-transport.js";
import type { NormalizedChatEvent } from "../protocol/chat-event.js";
import type { DownloadMediaOptions, DownloadMediaResult } from "../protocol/chat-event.js";
import { GatewayFault } from "../internal/errors.js";
import { cipherBudgetForPlain, decodeCdnAesMaterial, openAes128Ecb, sealAes128Ecb } from "./symmetric-block.js";
import { guessMimeByPath } from "../internal/mime-table.js";
import { materializeUserSuppliedFile } from "../internal/load-bytes.js";
import type { InputFile } from "../protocol/chat-event.js";

export interface StagedCipherPayload {
    slotKey: string;
    remoteHandle: string;
    aesKeyHex: string;
    plainBytes: number;
    cipherBudget: number;
    originalName: string;
    mime: string;
}

function cdnPullUrl(handle: string, cdnRoot: string): string {
    return `${cdnRoot}/download?encrypted_query_param=${encodeURIComponent(handle)}`;
}

function cdnPushUrl(root: string, uploadToken: string, slotKey: string): string {
    return `${root}/upload?encrypted_query_param=${encodeURIComponent(uploadToken)}&filekey=${encodeURIComponent(slotKey)}`;
}

async function postCiphertextToEdge(
    transport: IlinkJsonTransport,
    uploadToken: string,
    slotKey: string,
    key16: Buffer,
    plain: Buffer,
): Promise<string> {
    const body = sealAes128Ecb(plain, key16);
    const response = await fetch(
        cdnPushUrl(transport.cdnBaseUrl, uploadToken, slotKey),
        {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: new Uint8Array(body),
        },
    );

    if (response.status >= 400 && response.status < 500) {
        const hint = response.headers.get("x-error-message") ?? (await response.text());
        throw new GatewayFault("CDN_UPLOAD_CLIENT_ERROR", `边缘写入失败: ${hint}`);
    }
    if (response.status !== 200) {
        const hint = response.headers.get("x-error-message") ?? `HTTP ${String(response.status)}`;
        throw new GatewayFault("CDN_UPLOAD_SERVER_ERROR", `边缘写入失败: ${hint}`);
    }
    const headerHandle = response.headers.get("x-encrypted-param");
    if (!headerHandle) {
        throw new GatewayFault("CDN_UPLOAD_MISSING_PARAM", "响应缺少 x-encrypted-param");
    }
    return headerHandle;
}

/** 申请槽位并上传密文，返回后续 sendmessage 所需句柄 */
export async function stageBinaryForPeer(params: {
    transport: IlinkJsonTransport;
    input: InputFile;
    peerKey: string;
    uploadKind: number;
    filename?: string;
    contentType?: string;
}): Promise<StagedCipherPayload> {
    const blob = await materializeUserSuppliedFile(params.input, {
        filename: params.filename,
        contentType: params.contentType,
    });
    const slotKey = crypto.randomBytes(16).toString("hex");
    const key16 = crypto.randomBytes(16);
    const plainLen = blob.buffer.length;
    const md5hex = crypto.createHash("md5").update(blob.buffer).digest("hex");
    const padded = cipherBudgetForPlain(plainLen);

    const grant = await params.transport.reserveCdnUploadSlot({
        filekey: slotKey,
        media_type: params.uploadKind,
        to_user_id: params.peerKey,
        rawsize: plainLen,
        rawfilemd5: md5hex,
        filesize: padded,
        no_need_thumb: true,
        aeskey: key16.toString("hex"),
    });

    if (!grant.upload_param) {
        throw new GatewayFault("UPLOAD_URL_MISSING", "reserveCdnUploadSlot 未返回 upload_param");
    }

    const remoteHandle = await postCiphertextToEdge(
        params.transport,
        grant.upload_param,
        slotKey,
        key16,
        blob.buffer,
    );

    return {
        slotKey,
        remoteHandle,
        aesKeyHex: key16.toString("hex"),
        plainBytes: plainLen,
        cipherBudget: padded,
        originalName: blob.fileName,
        mime: blob.contentType,
    };
}

function resolveDownloadTarget(evt: NormalizedChatEvent): {
    handle: string;
    key16?: Buffer;
    fallbackName: string;
    mime: string;
} {
    if (!evt.media) {
        throw new GatewayFault("NO_MEDIA", "当前事件不含可下载媒体");
    }
    switch (evt.media.kind) {
        case "photo": {
            let key16: Buffer | undefined;
            if (evt.media.item.aeskey) {
                key16 = Buffer.from(evt.media.item.aeskey, "hex");
            } else if (evt.media.aesKey) {
                key16 = decodeCdnAesMaterial(evt.media.aesKey);
            }
            return {
                handle: evt.media.fileId,
                key16,
                fallbackName: "image.jpg",
                mime: "image/jpeg",
            };
        }
        case "video":
            return {
                handle: evt.media.fileId,
                key16: evt.media.aesKey ? decodeCdnAesMaterial(evt.media.aesKey) : undefined,
                fallbackName: "video.mp4",
                mime: "video/mp4",
            };
        case "document":
            return {
                handle: evt.media.fileId,
                key16: evt.media.aesKey ? decodeCdnAesMaterial(evt.media.aesKey) : undefined,
                fallbackName: evt.media.fileName ?? "file.bin",
                mime: guessMimeByPath(evt.media.fileName ?? "file.bin"),
            };
        case "voice":
            return {
                handle: evt.media.fileId,
                key16: evt.media.aesKey ? decodeCdnAesMaterial(evt.media.aesKey) : undefined,
                fallbackName: "voice.silk",
                mime: "audio/silk",
            };
    }
}

export async function pullUserMediaAttachment(params: {
    transport: IlinkJsonTransport;
    message: NormalizedChatEvent;
    options?: DownloadMediaOptions;
}): Promise<DownloadMediaResult> {
    const spec = resolveDownloadTarget(params.message);
    const response = await fetch(cdnPullUrl(spec.handle, params.transport.cdnBaseUrl));
    if (!response.ok) {
        throw new GatewayFault("CDN_DOWNLOAD_FAILED", `拉取失败 ${response.status} ${response.statusText}`);
    }
    const cipher = Buffer.from(await response.arrayBuffer());
    const plain = spec.key16 ? openAes128Ecb(cipher, spec.key16) : cipher;
    if (params.options?.filePath) {
        await fs.writeFile(params.options.filePath, plain);
    }
    return { buffer: plain, fileName: spec.fallbackName, mimeType: spec.mime };
}

export function mapMimeFamilyToUploadKind(contentType: string): number {
    if (contentType.startsWith("image/")) return 1;
    if (contentType.startsWith("video/")) return 2;
    return 3;
}
