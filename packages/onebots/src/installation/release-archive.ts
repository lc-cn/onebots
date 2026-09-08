import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const INPUT_LIMIT = 32 * 1024 * 1024;
const TAR_LIMIT = 64 * 1024 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const FAILURE = "目标发布包检查失败";
const FILES = [
    "package/package.json",
    "package/lib/extension-capability-catalog.json",
    "package/lib/gateway/entry.js",
];
const unzip = promisify(gunzip);

/** 只读固定发布元数据；不安装依赖、不运行包代码、不提取归档成员到磁盘。 */
export async function readReleaseArchive(bytes: Uint8Array): Promise<{
    manifest: unknown;
    catalog: unknown;
}> {
    let directory: string | undefined;
    try {
        if (
            !["darwin", "linux"].includes(process.platform) ||
            bytes.byteLength === 0 ||
            bytes.byteLength > INPUT_LIMIT
        )
            throw new Error(FAILURE);
        // Node 内置解压有总量上限；tar 只读取未压缩容器，无需 gzip 可执行程序。
        const archive = await unzip(bytes, { maxOutputLength: TAR_LIMIT });
        assertPlainNpmTar(archive);
        directory = await mkdtemp(join(tmpdir(), "onebots-release-"));
        await chmod(directory, 0o700);
        const filename = join(directory, "release.tar");
        await writeFile(filename, archive, { flag: "wx", mode: 0o600 });
        const members = (await readTar(["-tf", filename])).split("\n");
        for (const name of FILES)
            if (members.filter(member => member === name).length !== 1) throw new Error(FAILURE);
        const contents: string[] = [];
        for (const name of FILES) contents.push(await readTar(["-xOf", filename, name]));
        if (!contents[2].trim()) throw new Error(FAILURE);
        return { manifest: JSON.parse(contents[0]), catalog: JSON.parse(contents[1]) };
    } catch {
        // tar stderr、临时路径和包内容均不跨越发布检查边界。
        throw new Error(FAILURE);
    } finally {
        if (directory) {
            try {
                await rm(directory, { recursive: true, force: true });
            } catch {
                throw new Error(FAILURE);
            }
        }
    }
}

function readTar(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            process.platform === "darwin" ? "/usr/bin/tar" : "/bin/tar",
            args,
            {
                env: { PATH: "/usr/bin:/bin", LANG: "C" },
                encoding: "utf8",
                timeout: 15_000,
                maxBuffer: OUTPUT_LIMIT,
                killSignal: "SIGKILL",
                windowsHide: true,
            },
            (error, stdout) => {
                if (error) reject(new Error(FAILURE));
                else resolve(stdout);
            },
        );
    });
}

/** 只识别 npm 惯用的未压缩 POSIX tar 首头，成员解析仍完全交给系统 tar。 */
function assertPlainNpmTar(archive: Uint8Array): void {
    if (archive.byteLength < 512) throw new Error(FAILURE);
    const header = Buffer.from(archive.subarray(0, 512));
    const magic = header.subarray(257, 263);
    if (
        !header.subarray(0, 8).equals(Buffer.from("package/", "ascii")) ||
        (!magic.equals(Buffer.from("ustar\0", "ascii")) &&
            !magic.equals(Buffer.from("ustar ", "ascii")))
    )
        throw new Error(FAILURE);
    const checksumBytes = header.subarray(148, 156);
    if (checksumBytes.some(byte => byte > 127)) throw new Error(FAILURE);
    const checksum = checksumBytes.toString("ascii");
    if (!/^[ \0]*[0-7]+[ \0]*$/.test(checksum)) throw new Error(FAILURE);
    let sum = 0;
    for (let offset = 0; offset < header.length; offset++)
        sum += offset >= 148 && offset < 156 ? 32 : header[offset];
    if (Number.parseInt(checksum.replace(/[ \0]/g, ""), 8) !== sum) throw new Error(FAILURE);
}
