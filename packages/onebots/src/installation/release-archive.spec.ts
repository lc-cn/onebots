import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { readReleaseArchive } from "./release-archive.js";
vi.mock("node:child_process", async original => {
    const module = await original<typeof import("node:child_process")>();
    return { ...module, execFile: vi.fn(module.execFile) };
});
const roots: string[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
    for (const directory of roots.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture(
    options: { missing?: string; manifest?: string; symlink?: string; duplicate?: boolean } = {},
) {
    const directory = await mkdtemp(join(tmpdir(), "ob-release-test-"));
    roots.push(directory);
    await mkdir(join(directory, "package/lib/gateway"), { recursive: true });
    const files: Record<string, string> = {
        "package/package.json": options.manifest ?? '{"name":"onebots","version":"1.2.12"}',
        "package/lib/extension-capability-catalog.json": '{"schemaVersion":2,"packages":{}}',
        "package/lib/gateway/entry.js": 'throw new Error("MUST NOT EXECUTE");',
    };
    for (const [name, contents] of Object.entries(files)) {
        if (name === options.missing) continue;
        if (name === options.symlink) await symlink("/etc/passwd", join(directory, name));
        else await writeFile(join(directory, name), contents);
    }
    const archive = join(directory, "release.tar");
    execFileSync(
        "/usr/bin/tar",
        [
            "-cf",
            archive,
            "-C",
            directory,
            ...Object.keys(files).filter(name => name !== options.missing),
        ],
        { env: { PATH: "/usr/bin:/bin", LANG: "C" } },
    );
    if (options.duplicate)
        execFileSync("/usr/bin/tar", ["-rf", archive, "-C", directory, "package/package.json"]);
    return { directory, archive, bytes: gzipSync(await readFile(archive)) };
}
it("reads two JSON documents and requires an entry without executing package code", async () => {
    const f = await fixture();
    await expect(readReleaseArchive(f.bytes)).resolves.toEqual({
        manifest: { name: "onebots", version: "1.2.12" },
        catalog: { schemaVersion: 2, packages: {} },
    });
});
it.each(["package/lib/gateway/entry.js", "package/lib/extension-capability-catalog.json"])(
    "rejects missing %s",
    async missing => {
        await expect(readReleaseArchive((await fixture({ missing })).bytes)).rejects.toThrow(
            "目标发布包检查失败",
        );
    },
);
it.each(["not-json", "x".repeat(2 * 1024 * 1024 + 1)])(
    "rejects invalid or oversized metadata",
    async manifest => {
        await expect(readReleaseArchive((await fixture({ manifest })).bytes)).rejects.toThrow(
            "目标发布包检查失败",
        );
    },
);
it("rejects duplicate JSON entries", async () => {
    await expect(readReleaseArchive((await fixture({ duplicate: true })).bytes)).rejects.toThrow(
        "目标发布包检查失败",
    );
});
it.each(["package/package.json", "package/lib/gateway/entry.js"])(
    "does not follow archive symlink %s",
    async symlink => {
        await expect(readReleaseArchive((await fixture({ symlink })).bytes)).rejects.toThrow(
            "目标发布包检查失败",
        );
    },
);
it("bounds compressed and uncompressed bytes and rejects malformed compression", async () => {
    for (const bytes of [
        new Uint8Array(),
        new Uint8Array(32 * 1024 * 1024 + 1),
        new Uint8Array([1, 2]),
        gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1)),
    ])
        await expect(readReleaseArchive(bytes)).rejects.toThrow("目标发布包检查失败");
});
it("does not inherit tar or compression commands from the manager environment", async () => {
    const f = await fixture();
    vi.stubEnv("TAR_OPTIONS", "--use-compress-program=/definitely-not-a-program");
    vi.stubEnv("GZIP", "--invalid-option");
    vi.stubEnv("NODE_OPTIONS", "--require=/definitely-not-a-program");
    vi.stubEnv("PATH", "/definitely-not-a-directory");
    await expect(readReleaseArchive(f.bytes)).resolves.toHaveProperty("manifest");
});

it("never writes archive traversal members to the filesystem", async () => {
    const f = await fixture();
    const marker = join(f.directory, "escaped");
    await writeFile(join(f.directory, "escape"), "must not write out");
    const traversal = `../${basename(f.directory)}/escaped`;
    const transform =
        process.platform === "darwin"
            ? ["-s", `|^escape$|${traversal}|`]
            : [`--transform=s|^escape$|${traversal}|`];
    execFileSync("/usr/bin/tar", ["-rf", f.archive, "-C", f.directory, ...transform, "escape"]);
    await readReleaseArchive(gzipSync(await readFile(f.archive))).catch(error => {
        expect(error.message).toBe("目标发布包检查失败");
    });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(f.directory, "escape"), "utf8")).toBe("must not write out");
});

it("rejects nested compression and forged ustar headers before invoking tar", async () => {
    const f = await fixture();
    const forged = Buffer.alloc(512);
    forged.write("package/package.json");
    forged.write("ustar\0", 257);
    forged.write("000000\0 ", 148);
    const variants = [f.bytes, Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), forged];
    for (const payload of variants) {
        vi.mocked(execFile).mockClear();
        await expect(readReleaseArchive(gzipSync(payload))).rejects.toThrow("目标发布包检查失败");
        expect(execFile).not.toHaveBeenCalled();
    }
});

it("pins platform tar path, safe environment and bounded execution options", async () => {
    const f = await fixture(); vi.mocked(execFile).mockClear();
    vi.stubEnv("PRIVATE_AUTH_TOKEN", "must-not-reach-tar");
    await readReleaseArchive(f.bytes);
    expect(execFile).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(execFile).mock.calls) {
        expect(call[0]).toBe(process.platform === "darwin" ? "/usr/bin/tar" : "/bin/tar");
        expect(call[2]).toMatchObject({ env: { PATH: "/usr/bin:/bin", LANG: "C" }, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, killSignal: "SIGKILL" });
        expect(JSON.stringify(call[2])).not.toContain("must-not-reach-tar");
        expect(call[2]).not.toHaveProperty("shell");
    }
});
