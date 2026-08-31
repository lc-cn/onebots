import { describe, expect, it } from "vitest";
import { materializeMatrixUpload } from "./adapter-support.js";

describe("Matrix 上传边界", () => {
    it("只接受宿主已读取的 base64 数据", () => {
        expect(materializeMatrixUpload({ data: "aGVsbG8=" })).toEqual(
            new Uint8Array(Buffer.from("hello")),
        );
        expect(() => materializeMatrixUpload({ data: "not base64" })).toThrow(/base64/u);
    });

    it("拒绝本地路径和远程 URL，避免越权 I/O", () => {
        expect(() => materializeMatrixUpload({ path: "/etc/passwd" })).toThrow(/本地路径/u);
        expect(() => materializeMatrixUpload({ url: "https://metadata.internal/" })).toThrow(
            /远程 URL/u,
        );
    });
});
