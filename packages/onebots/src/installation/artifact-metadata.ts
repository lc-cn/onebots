import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { GenerationArtifact } from "./generation-plan.js";

const unzip = promisify(gunzip);
const FAILURE = "本地扩展工件元数据无法验证";
const ARCHIVE_LIMIT = 32 * 1024 * 1024;

/** 只读同一组已校验字节，不解包到磁盘、不执行扩展、不回退到 registry。 */
export async function readArtifactMetadata(artifact: GenerationArtifact): Promise<unknown> {
    try {
        const file = artifact.spec.slice(5);
        if (
            !artifact.spec.startsWith("file:") ||
            !isAbsolute(file) ||
            !file.endsWith(".tgz") ||
            !artifact.sha256 ||
            !/^[a-f0-9]{64}$/.test(artifact.sha256)
        )
            throw new Error();
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let bytes: Buffer;
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size <= 0 || stat.size > ARCHIVE_LIMIT) throw new Error();
            bytes = Buffer.alloc(stat.size + 1);
            let length = 0;
            while (length < bytes.length) {
                const read = await handle.read(bytes, length, bytes.length - length, length);
                if (!read.bytesRead) break;
                length += read.bytesRead;
            }
            if (length !== stat.size) throw new Error();
            bytes = bytes.subarray(0, length);
        } finally {
            await handle.close();
        }
        if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error();
        return manifestFromTar(await unzip(bytes, { maxOutputLength: 64 * 1024 * 1024 }));
    } catch {
        // 不将本地路径、归档内容或第三方异常泄露到控制接口。
        throw new Error(FAILURE);
    }
}

/** npm/pnpm 的普通 ustar：拒绝扩展头，避免长路径/PAX 重写制造元数据歧义。 */
function manifestFromTar(tar: Buffer): unknown {
    let manifest: unknown;
    let found = false;
    const octal = (bytes: Buffer) => {
        const value = bytes.toString("ascii").replace(/\0.*$/s, "").trim();
        if (!/^[0-7]+$/.test(value)) throw new Error();
        const number = Number.parseInt(value, 8);
        if (!Number.isSafeInteger(number)) throw new Error();
        return number;
    };
    const text = (bytes: Buffer) => bytes.toString("utf8").replace(/\0.*$/s, "");
    for (let offset = 0; offset + 512 <= tar.length; ) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(byte => byte === 0)) {
            if (!tar.subarray(offset).every(byte => byte === 0) || !found) throw new Error();
            return manifest;
        }
        let checksum = 0;
        for (let index = 0; index < 512; index++)
            checksum += index >= 148 && index < 156 ? 32 : header[index];
        if (
            checksum !== octal(header.subarray(148, 156)) ||
            text(header.subarray(257, 263)) !== "ustar"
        )
            throw new Error();
        const size = octal(header.subarray(124, 136));
        const start = offset + 512;
        const end = start + size;
        if (end > tar.length) throw new Error();
        const type = header[156];
        if (![0, 48, 49, 50, 53].includes(type)) throw new Error();
        const prefix = text(header.subarray(345, 500));
        const name = `${prefix ? `${prefix}/` : ""}${text(header.subarray(0, 100))}`;
        if (name === "package/package.json") {
            if (found || ![0, 48].includes(type) || size > 256 * 1024) throw new Error();
            manifest = JSON.parse(tar.subarray(start, end).toString("utf8"));
            found = true;
        }
        offset = start + Math.ceil(size / 512) * 512;
    }
    throw new Error();
}
