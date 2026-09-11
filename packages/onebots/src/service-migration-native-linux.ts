import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const failure = () => new Error("无法确认旧运行文件仅依赖 Linux 系统原生库，已拒绝迁移");
export interface LinuxNativeDependencies {
    machine: number;
    needed: string[];
    interpreter?: string;
}

/** ELF64 little-endian only. No loader or code from the inspected file is executed. */
export async function inspectLinuxElf(file: string): Promise<LinuxNativeDependencies> {
    const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > 512 * 1024 * 1024) throw failure();
        const read = async (offset: number, length: number) => {
            if (
                !Number.isSafeInteger(offset) ||
                !Number.isSafeInteger(length) ||
                offset < 0 ||
                length < 0 ||
                length > 4 * 1024 * 1024 ||
                offset + length > before.size
            )
                throw failure();
            const bytes = Buffer.alloc(length);
            if ((await handle.read(bytes, 0, length, offset)).bytesRead !== length) throw failure();
            return bytes;
        };
        const integer = (bytes: Buffer, offset: number) => {
            const value = Number(bytes.readBigUInt64LE(offset));
            if (!Number.isSafeInteger(value)) throw failure();
            return value;
        };
        const header = await read(0, 64);
        if (
            header.subarray(0, 7).toString("hex") !== "7f454c46020101" ||
            ![2, 3].includes(header.readUInt16LE(16)) ||
            header.readUInt32LE(20) !== 1 ||
            header.readUInt16LE(52) !== 64 ||
            header.readUInt16LE(54) !== 56
        )
            throw failure();
        const machine = header.readUInt16LE(18);
        if (![62, 183].includes(machine)) throw failure();
        const count = header.readUInt16LE(56);
        if (!count || count > 1024) throw failure();
        const programs = await read(integer(header, 32), count * 56);
        const segments: { type: number; offset: number; address: number; size: number }[] = [];
        for (let i = 0; i < count; i++) {
            const p = programs.subarray(i * 56, (i + 1) * 56);
            const segment = {
                type: p.readUInt32LE(0),
                offset: integer(p, 8),
                address: integer(p, 16),
                size: integer(p, 32),
            };
            if (
                segment.offset + segment.size > before.size ||
                !Number.isSafeInteger(segment.address + segment.size)
            )
                throw failure();
            segments.push(segment);
        }
        const dynamics = segments.filter(segment => segment.type === 2);
        const interpreters = segments.filter(segment => segment.type === 3);
        if (dynamics.length !== 1 || interpreters.length > 1) throw failure();
        let interpreter: string | undefined;
        const cstring = (bytes: Buffer, offset: number) => {
            const end = bytes.indexOf(0, offset);
            if (offset < 0 || end <= offset) throw failure();
            const value = bytes.subarray(offset, end).toString("utf8");
            if (!/^[A-Za-z0-9_./+-]+$/.test(value)) throw failure();
            return value;
        };
        if (interpreters.length) {
            const p = interpreters[0];
            const bytes = await read(p.offset, p.size);
            interpreter = cstring(bytes, 0);
            if (Buffer.byteLength(interpreter) + 1 !== bytes.length || !systemPath(interpreter))
                throw failure();
        }
        const dynamic = await read(dynamics[0].offset, dynamics[0].size);
        if (dynamic.length % 16) throw failure();
        let address: number | undefined;
        let size: number | undefined;
        let terminated = false;
        const needed: number[] = [];
        for (let i = 0; i < dynamic.length; i += 16) {
            const tag = integer(dynamic, i);
            const value = integer(dynamic, i + 8);
            if (tag === 0) {
                terminated = true;
                break;
            }
            // RPATH/RUNPATH and alternate/audit loaders cannot be retained safely.
            if ([15, 29, 0x7ffffffd, 0x7fffffff, 0x6ffffefa, 0x6ffffefb, 0x6ffffefc].includes(tag))
                throw failure();
            if (tag === 1) needed.push(value);
            if (tag === 5) {
                if (address !== undefined) throw failure();
                address = value;
            }
            if (tag === 10) {
                if (size !== undefined) throw failure();
                size = value;
            }
            if (tag === 0x6ffffffb && value & 0x800) throw failure(); // DF_1_NODEFLIB
        }
        if (!terminated || address === undefined || size === undefined || !size) throw failure();
        const mappings = segments.filter(
            segment =>
                segment.type === 1 &&
                address! >= segment.address &&
                address! + size! <= segment.address + segment.size,
        );
        if (mappings.length !== 1) throw failure();
        const strings = await read(mappings[0].offset + address - mappings[0].address, size);
        const names = needed.map(offset => {
            if (offset >= strings.length) throw failure();
            const name = cstring(strings, offset);
            if (name.includes("/") || name === "." || name === "..") throw failure();
            return name;
        });
        const after = await handle.stat();
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ctimeMs !== after.ctimeMs
        )
            throw failure();
        return { machine, needed: names, ...(interpreter ? { interpreter } : {}) };
    } finally {
        await handle.close();
    }
}

function systemPath(file: string): boolean {
    return (
        path.posix.normalize(file) === file &&
        ["/lib/", "/lib64/", "/usr/lib/", "/usr/lib64/"].some(root => file.startsWith(root))
    );
}

async function trustedSystemFile(file: string): Promise<string> {
    if (!systemPath(file)) throw failure();
    const canonical = await realpath(file);
    if (!systemPath(canonical)) throw failure();
    for (let current = canonical; ; current = path.dirname(current)) {
        const info = await stat(current);
        if (
            info.uid !== 0 ||
            info.mode & 0o022 ||
            (current === canonical ? !info.isFile() : !info.isDirectory())
        )
            throw failure();
        if (current === "/") break;
    }
    return canonical;
}

/** Parse all entries; trust checks apply only to names used by the inspected dependency graph. */
export function parseLinuxLoaderCache(output: string, machine: number): Map<string, string[]> {
    const entries = new Map<string, string[]>();
    const lines = output.trim().split("\n");
    const header = /^(\d+) libs found in cache [`'’][^`'’]+[`'’]$/.exec(lines.shift() ?? "");
    if (!header) throw failure();
    let count = 0;
    for (const line of lines) {
        if (line.startsWith("Cache generated by:")) continue;
        const entry = /^\s+(\S+) \(([^)]+)\) => (\S+)$/.exec(line);
        if (!entry) throw failure();
        count++;
        const [, name, abi, target] = entry;
        // Ignore explicitly other machine cache entries; reject ambiguous ABIs.
        if (machine === 62 && !abi.includes("x86-64")) continue;
        if (machine === 183 && !abi.includes("AArch64")) continue;
        entries.set(name, [...(entries.get(name) ?? []), target]);
    }
    if (count !== Number(header[1])) throw failure();
    return entries;
}

async function loaderPaths(machine: number): Promise<Map<string, string[]>> {
    try {
        if ((await readFile("/etc/ld.so.preload", "utf8")).trim()) throw failure();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let cacheFound = false;
    try {
        await stat("/etc/ld.so.cache");
        cacheFound = true;
        // ldconfig reads the cache only; it never executes the inspected binary.
        const command = await realpath("/sbin/ldconfig");
        const info = await stat(command);
        if (info.uid !== 0 || info.mode & 0o022 || !info.isFile()) throw failure();
        const result = await promisify(execFile)(command, ["-p"], {
            encoding: "utf8",
            timeout: 15_000,
            maxBuffer: 4 * 1024 * 1024,
            env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C", LANG: "C" },
        });
        if (result.stderr.trim()) throw failure();
        return parseLinuxLoaderCache(result.stdout, machine);
    } catch (error) {
        if (cacheFound || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // musl and uncached loaders require a separate search-path contract.
        throw failure();
    }
}

/** Preserve loader search order, but never permit a non-system library to satisfy it. */
export function parseMuslSearchPath(content: string): string[] {
    if (content.length > 64 * 1024 || /[^a-zA-Z0-9_/:\n-]/.test(content)) throw failure();
    const roots = content.replace(/\n+$/, "").split(/[:\n]/);
    if (
        !roots.length ||
        roots.some(
            root => !["/lib", "/usr/local/lib", "/usr/lib", "/lib64", "/usr/lib64"].includes(root),
        )
    )
        throw failure();
    return roots;
}

async function muslRoots(machine: number): Promise<string[]> {
    const config = `/etc/ld-musl-${machine === 62 ? "x86_64" : "aarch64"}.path`;
    try {
        const handle = await open(
            config,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
            const before = await handle.stat();
            const parent = await stat("/etc");
            const root = await stat("/");
            if (
                !before.isFile() ||
                before.uid !== 0 ||
                before.mode & 0o022 ||
                before.size > 64 * 1024 ||
                parent.uid !== 0 ||
                parent.mode & 0o022 ||
                root.uid !== 0 ||
                root.mode & 0o022
            )
                throw failure();
            const content = await handle.readFile("utf8");
            const after = await handle.stat();
            const current = await lstat(config);
            if (
                before.ino !== after.ino ||
                before.mtimeMs !== after.mtimeMs ||
                before.ctimeMs !== after.ctimeMs ||
                before.size !== after.size ||
                before.dev !== current.dev ||
                before.ino !== current.ino ||
                current.isSymbolicLink()
            )
                throw failure();
            return parseMuslSearchPath(content);
        } finally {
            await handle.close();
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return ["/lib", "/usr/local/lib", "/usr/lib"];
    }
}

/** Limited to standard distro library roots; custom loader caches and environment are unsupported. */
export async function assertLinuxSystemDependencies(file: string): Promise<void> {
    try {
        if (process.platform !== "linux" || !path.isAbsolute(file)) throw failure();
        const initial = await inspectLinuxElf(file);
        const triplet = initial.machine === 62 ? "x86_64-linux-gnu" : "aarch64-linux-gnu";
        let roots = [
            `/lib/${triplet}`,
            `/usr/lib/${triplet}`,
            "/lib64",
            "/usr/lib64",
            "/lib",
            "/usr/lib",
        ];
        const host = initial.interpreter
            ? initial
            : await inspectLinuxElf(await realpath(process.execPath));
        if (host.machine !== initial.machine) throw failure();
        const muslInterpreter = `/lib/ld-musl-${initial.machine === 62 ? "x86_64" : "aarch64"}.so.1`;
        const musl = host.interpreter === muslInterpreter;
        if (host.interpreter?.includes("musl") && !musl) throw failure();
        const cache = musl ? new Map<string, string[]>() : await loaderPaths(initial.machine);
        if (musl) roots = await muslRoots(initial.machine);
        const visited = new Set<string>();
        const inspect = async (dependencies: LinuxNativeDependencies): Promise<void> => {
            if (dependencies.machine !== initial.machine) throw failure();
            const files: string[] = [];
            if (musl && dependencies.interpreter && dependencies.interpreter !== muslInterpreter)
                throw failure();
            if (dependencies.interpreter)
                files.push(await trustedSystemFile(dependencies.interpreter));
            for (const name of dependencies.needed) {
                for (const cached of cache.get(name) ?? [])
                    files.push(await trustedSystemFile(cached));
                let found: string | undefined;
                for (const root of roots) {
                    const candidate = path.join(root, name);
                    try {
                        // musl searches /usr/local/lib by default. If it provides a library,
                        // reject rather than silently falling through to a different system copy.
                        await lstat(candidate);
                        found = await trustedSystemFile(candidate);
                        break;
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                    }
                }
                if (!found) throw failure();
                files.push(found);
            }
            for (const dependency of files) {
                if (visited.has(dependency)) continue;
                if (visited.size >= 256) throw failure();
                visited.add(dependency);
                await inspect(await inspectLinuxElf(dependency));
            }
        };
        await inspect(initial);
    } catch {
        throw failure();
    }
}
