import { afterEach, describe, expect, it, vi } from "vitest";
import { IlinkJsonTransport } from "../transport/ilink-json-transport.js";
import type { NormalizedChatEvent } from "../protocol/chat-event.js";
import { pullUserMediaAttachment, stageBinaryForPeer } from "./payload-pipeline.js";

afterEach(() => vi.unstubAllGlobals());

describe("iLink CDN 管线", () => {
    it("优先使用服务端返回的完整上传 URL", async () => {
        const transport = new IlinkJsonTransport({ cdnBaseUrl: "https://legacy-cdn.test/c2c" });
        vi.spyOn(transport, "reserveCdnUploadSlot").mockResolvedValue({
            upload_param: "legacy",
            upload_full_url: "https://upload.cdn.test/direct?signature=ok",
        });
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 200,
                    headers: { "x-encrypted-param": "remote-handle" },
                }),
            );
        vi.stubGlobal("fetch", fetchMock);

        const result = await stageBinaryForPeer({
            transport,
            input: Buffer.from("hello"),
            peerKey: "peer",
            uploadKind: 3,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://upload.cdn.test/direct?signature=ok");
        expect(result.remoteHandle).toBe("remote-handle");
    });

    it("优先使用完整下载 URL，并拒绝非 HTTPS 地址", async () => {
        const transport = new IlinkJsonTransport({ cdnBaseUrl: "https://legacy-cdn.test/c2c" });
        const fetchMock = vi.fn(async () => new Response(Buffer.from("plain")));
        vi.stubGlobal("fetch", fetchMock);
        const message = mediaEvent("https://download.cdn.test/direct?signature=ok");
        await expect(pullUserMediaAttachment({ transport, message })).resolves.toMatchObject({
            buffer: Buffer.from("plain"),
        });
        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://download.cdn.test/direct?signature=ok");
        await pullUserMediaAttachment({
            transport,
            message: mediaHandleEvent("https://looks-like-a-url"),
        });
        expect(fetchMock.mock.calls[1]?.[0]).toBe(
            "https://legacy-cdn.test/c2c/download?encrypted_query_param=https%3A%2F%2Flooks-like-a-url",
        );
        await expect(
            pullUserMediaAttachment({ transport, message: mediaEvent("http://unsafe.test/file") }),
        ).rejects.toMatchObject({ code: "CDN_DOWNLOAD_URL_INVALID" });
    });
});

function mediaEvent(downloadUrl: string): NormalizedChatEvent {
    return {
        id: 1,
        seq: 1,
        type: "photo",
        chat: { id: "peer", type: "private" },
        from: { id: "peer" },
        date: Date.now(),
        media: {
            kind: "photo",
            downloadUrl,
            item: { media: { full_url: downloadUrl } },
        },
        raw: { message_type: 1, from_user_id: "peer", message_id: 1 },
    };
}

function mediaHandleEvent(fileId: string): NormalizedChatEvent {
    return {
        ...mediaEvent("https://placeholder.test"),
        media: {
            kind: "photo",
            fileId,
            item: { media: { encrypt_query_param: fileId } },
        },
    };
}
