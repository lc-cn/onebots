import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    inspectLinuxElf,
    parseMuslSearchPath,
    parseLinuxLoaderCache,
    assertLinuxSystemDependencies,
} from "./service-migration-native-linux.js";

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
    );
});
function elf(tag = 1, needed = "libc.so.6", interpreter?: string): Buffer {
    const bytes = Buffer.alloc(1024);
    Buffer.from("7f454c46020101", "hex").copy(bytes);
    bytes.writeUInt16LE(3, 16);
    bytes.writeUInt16LE(62, 18);
    bytes.writeUInt32LE(1, 20);
    bytes.writeBigUInt64LE(64n, 32);
    bytes.writeUInt16LE(64, 52);
    bytes.writeUInt16LE(56, 54);
    bytes.writeUInt16LE(interpreter ? 3 : 2, 56);
    const segment = (index: number, type: number, offset: number, size: number) => {
        const p = 64 + index * 56;
        bytes.writeUInt32LE(type, p);
        bytes.writeBigUInt64LE(BigInt(offset), p + 8);
        bytes.writeBigUInt64LE(BigInt(offset), p + 16);
        bytes.writeBigUInt64LE(BigInt(size), p + 32);
    };
    segment(0, 1, 0, 1024);
    segment(1, 2, 256, 64);
    [
        [tag, 1],
        [5, 512],
        [10, 128],
        [0, 0],
    ].forEach(([t, v], i) => {
        bytes.writeBigUInt64LE(BigInt(t), 256 + i * 16);
        bytes.writeBigUInt64LE(BigInt(v), 264 + i * 16);
    });
    bytes.write(needed, 513);
    if (interpreter) {
        segment(2, 3, 768, Buffer.byteLength(interpreter) + 1);
        bytes.write(interpreter, 768);
    }
    return bytes;
}
async function fixture(bytes: Buffer) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ob-elf-"));
    directories.push(directory);
    const file = path.join(directory, "binary");
    await writeFile(file, bytes);
    return file;
}
describe("Linux static native dependencies", () => {
    it("keeps unrelated external cache entries without treating them as dependencies", () => {
        const cache = parseLinuxLoaderCache(
            "2 libs found in cache `/etc/ld.so.cache'\n\tlibunrelated.so (libc6,x86-64) => /opt/unrelated/libunrelated.so\n\tlibc.so.6 (libc6,x86-64) => /lib/libc.so.6\n",
            62,
        );
        expect(cache.get("libc.so.6")).toEqual(["/lib/libc.so.6"]);
        expect(cache.get("libunrelated.so")).toEqual(["/opt/unrelated/libunrelated.so"]);
    });
    it("retains every matching dependency cache candidate for later trust checks", () => {
        const cache = parseLinuxLoaderCache(
            "2 libs found in cache `/etc/ld.so.cache'\n\tlibc.so.6 (libc6,x86-64) => /opt/unsafe/libc.so.6\n\tlibc.so.6 (libc6,x86-64) => /lib/libc.so.6\n",
            62,
        );
        expect(cache.get("libc.so.6")).toEqual(["/opt/unsafe/libc.so.6", "/lib/libc.so.6"]);
    });
    it("preserves musl system search order", () => {
        expect(parseMuslSearchPath("/lib:/usr/local/lib:/usr/lib\n")).toEqual([
            "/lib",
            "/usr/local/lib",
            "/usr/lib",
        ]);
        expect(parseMuslSearchPath("/lib\n/usr/lib\n")).toEqual(["/lib", "/usr/lib"]);
    });
    it.each([
        "",
        "/tmp:/lib",
        "/lib:",
        "/lib/../tmp",
        "$ORIGIN:/lib",
        "/lib::/usr/lib",
        "/lib\r\n/usr/lib",
    ])("rejects unsafe musl path %s", content => {
        expect(() => parseMuslSearchPath(content)).toThrow();
    });
    it("reads dynamic dependencies without running the binary", async () => {
        expect(await inspectLinuxElf(await fixture(elf()))).toEqual({
            machine: 62,
            needed: ["libc.so.6"],
        });
    });
    it.each([15, 29, 0x7ffffffd, 0x7fffffff, 0x6ffffefb, 0x6ffffefc])(
        "rejects loader override tag %s",
        async tag => {
            await expect(inspectLinuxElf(await fixture(elf(tag)))).rejects.toThrow();
        },
    );
    it.each(["../libc.so.6", "/tmp/libc.so.6", "lib c.so.6"])(
        "rejects dependency path %s",
        async name => {
            await expect(inspectLinuxElf(await fixture(elf(1, name)))).rejects.toThrow();
        },
    );
    it("rejects external interpreter", async () => {
        await expect(
            inspectLinuxElf(await fixture(elf(1, "libc.so.6", "/tmp/ld.so"))),
        ).rejects.toThrow();
    });
    it("accepts static system interpreter metadata", async () => {
        expect(
            (
                await inspectLinuxElf(
                    await fixture(elf(1, "libc.so.6", "/lib64/ld-linux-x86-64.so.2")),
                )
            ).interpreter,
        ).toBe("/lib64/ld-linux-x86-64.so.2");
    });
    it("rejects truncated or wrong architecture files", async () => {
        await expect(inspectLinuxElf(await fixture(Buffer.alloc(12)))).rejects.toThrow();
        const bytes = elf();
        bytes.writeUInt16LE(3, 18);
        await expect(inspectLinuxElf(await fixture(bytes))).rejects.toThrow();
    });
    it.skipIf(process.platform !== "linux")("inspects real Node recursively", async () => {
        await expect(
            assertLinuxSystemDependencies(
                await import("node:fs/promises").then(fs => fs.realpath(process.execPath)),
            ),
        ).resolves.toBeUndefined();
    });
});
