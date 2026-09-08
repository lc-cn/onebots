import { describe, expect, it, vi } from "vitest";
import { IlinkJsonTransport } from "../transport/ilink-json-transport.js";
import type { StagedCipherPayload } from "../cdn/payload-pipeline.js";
import { postFileBundle, postPhotoBundle, postVideoBundle } from "./assembler.js";

const staged: StagedCipherPayload = {
    slotKey: "slot",
    remoteHandle: "remote-handle",
    aesKeyHex: "00112233445566778899aabbccddeeff",
    plainMd5Hex: "5d41402abc4b2a76b9719d911017c592",
    plainBytes: 5,
    cipherBudget: 16,
    originalName: "hello.txt",
    mime: "text/plain",
};

describe("iLink 出站媒体消息", () => {
    it("按协议发送 Base64(hex) AES 密钥及图片密文大小", async () => {
        const transport = createTransport();
        await postPhotoBundle(transport, "peer", "context", staged);

        const item = sentItem(transport);
        expect(item.image_item?.media?.aes_key).toBe(
            Buffer.from(staged.aesKeyHex, "utf8").toString("base64"),
        );
        expect(Buffer.from(item.image_item?.media?.aes_key ?? "", "base64").toString("ascii")).toBe(
            staged.aesKeyHex,
        );
        expect(item.image_item).toMatchObject({ hd_size: 16, mid_size: 16 });
    });

    it("视频沿用相同密钥格式并发送明文大小", async () => {
        const transport = createTransport();
        await postVideoBundle(transport, "peer", "context", staged);

        const item = sentItem(transport);
        expect(item.video_item?.media?.aes_key).toBe(
            Buffer.from(staged.aesKeyHex, "utf8").toString("base64"),
        );
        expect(item.video_item?.video_size).toBe(staged.plainBytes);
    });

    it("文件携带可解密的密钥、明文长度与 MD5", async () => {
        const transport = createTransport();
        await postFileBundle(transport, "peer", "context", staged);

        const item = sentItem(transport);
        expect(item.file_item).toMatchObject({
            file_name: staged.originalName,
            len: String(staged.plainBytes),
            md5: staged.plainMd5Hex,
            media: {
                aes_key: Buffer.from(staged.aesKeyHex, "utf8").toString("base64"),
                encrypt_query_param: staged.remoteHandle,
                encrypt_type: 1,
            },
        });
    });
});

function createTransport(): IlinkJsonTransport {
    const transport = new IlinkJsonTransport({ baseUrl: "https://example.test" });
    vi.spyOn(transport, "dispatchOutboundEnvelope").mockResolvedValue({});
    return transport;
}

function sentItem(transport: IlinkJsonTransport) {
    const dispatch = vi.mocked(transport.dispatchOutboundEnvelope);
    const envelope = dispatch.mock.calls[0]?.[0];
    const item = envelope?.msg?.item_list?.[0];
    expect(item).toBeDefined();
    return item!;
}
