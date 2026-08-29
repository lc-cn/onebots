import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeICQQUpload } from "./media.js";

afterEach(() => vi.unstubAllGlobals());

function params(source: { url?: string; path?: string; data?: string }) {
    return {
        scene_type: "private" as const,
        scene_id: { string: "1", number: 1, source: 1 },
        name: "hello.txt",
        ...source,
    };
}

describe("ICQQ 文件来源", () => {
    it("支持官方 HTTP(S) 文件 URI", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("hello", { status: 200 })),
        );
        await expect(
            materializeICQQUpload(params({ url: "https://example.test/hello.txt" })),
        ).resolves.toEqual(Buffer.from("hello"));
    });

    it("严格解码 Base64 并拒绝歧义或空来源", async () => {
        await expect(materializeICQQUpload(params({ data: "aGVsbG8=" }))).resolves.toEqual(
            Buffer.from("hello"),
        );
        await expect(materializeICQQUpload(params({ data: "%%%" }))).rejects.toThrow(
            "Base64 数据无效",
        );
        await expect(
            materializeICQQUpload(params({ url: "https://example.test/file", path: "/tmp/file" })),
        ).rejects.toThrow("必须且只能提供");
        await expect(materializeICQQUpload(params({}))).rejects.toThrow("必须且只能提供");
    });
});
