import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { assertLinuxSystemDependencies } from "./service-migration-native-linux.js";

const runFile = promisify(execFile);
const failure = () => new Error("无法确认旧运行文件仅依赖系统原生库，已拒绝迁移");
const ordinaryCommands = new Set([
    "LC_SEGMENT",
    "LC_SEGMENT_64",
    "LC_SYMTAB",
    "LC_DYSYMTAB",
    "LC_UUID",
    "LC_BUILD_VERSION",
    "LC_VERSION_MIN_MACOSX",
    "LC_SOURCE_VERSION",
    "LC_MAIN",
    "LC_FUNCTION_STARTS",
    "LC_DATA_IN_CODE",
    "LC_CODE_SIGNATURE",
    "LC_SEGMENT_SPLIT_INFO",
    "LC_DYLD_INFO",
    "LC_DYLD_INFO_ONLY",
    "LC_DYLD_CHAINED_FIXUPS",
    "LC_DYLD_EXPORTS_TRIE",
    "LC_LINKER_OPTIMIZATION_HINT",
    "LC_TWOLEVEL_HINTS",
    "LC_ROUTINES",
    "LC_ROUTINES_64",
    "LC_THREAD",
    "LC_UNIXTHREAD",
    "LC_NOTE",
]);
const libraryCommands = new Set([
    "LC_LOAD_DYLIB",
    "LC_LOAD_WEAK_DYLIB",
    "LC_REEXPORT_DYLIB",
    "LC_LOAD_UPWARD_DYLIB",
    "LC_LAZY_LOAD_DYLIB",
    "LC_ID_DYLIB",
]);

function systemLibrary(value: string): boolean {
    return (
        !/[\s\\\x00-\x1f\x7f]/u.test(value) &&
        path.posix.normalize(value) === value &&
        (value.startsWith("/usr/lib/") || value.startsWith("/System/Library/")) &&
        !value.endsWith("/")
    );
}

function inspectCommand(lines: string[]): boolean {
    const command = /^\s+cmd (LC_[A-Z0-9_]+)$/.exec(lines[0] ?? "")?.[1];
    const size = /^\s+cmdsize ([1-9][0-9]*)$/.exec(lines[1] ?? "")?.[1];
    if (
        !command ||
        !size ||
        !Number.isSafeInteger(Number(size)) ||
        Number(size) < 8 ||
        lines.slice(2).some(line => /^\s*cmd(?:size)?\s/.test(line))
    )
        throw failure();
    if (libraryCommands.has(command)) {
        const name = /^\s+name (.+) \(offset ([0-9]+)\)$/.exec(lines[2] ?? "");
        if (
            lines.length !== 6 ||
            !name ||
            Number(name[2]) !== 24 ||
            Number(size) <= 24 + Buffer.byteLength(name[1]) ||
            !systemLibrary(name[1]) ||
            !/^\s+time stamp [0-9]+ .+$/.test(lines[3]) ||
            !/^\s+current version [0-9]+\.[0-9]+\.[0-9]+$/.test(lines[4]) ||
            !/^compatibility version [0-9]+\.[0-9]+\.[0-9]+$/.test(lines[5])
        )
            throw failure();
        return command !== "LC_ID_DYLIB";
    }
    if (command === "LC_LOAD_DYLINKER") {
        if (
            lines.length !== 3 ||
            !/^\s+name \/usr\/lib\/dyld \(offset 12\)$/.test(lines[2]) ||
            Number(size) < 26
        )
            throw failure();
        return false;
    }
    // RPATH, embedded loader environment and unrecognised load commands fail closed.
    if (
        !ordinaryCommands.has(command) ||
        lines
            .slice(2)
            .some(line => line !== "Section" && !/^\s+[A-Za-z_][A-Za-z_0-9]*\s+\S.*$/.test(line))
    )
        throw failure();
    return false;
}

/** Static otool output parser; exported so malformed and multi-architecture input is testable. */
export function assertDarwinSystemDependencies(output: string, file: string): void {
    if (!output || /[\x00-\x08\x0b-\x1f\x7f]/u.test(output)) throw failure();
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const header = new RegExp(`^${escaped}(?: \\(architecture [A-Za-z0-9_]+\\))?:$`);
    let slices = 0;
    let count = 0;
    let dependencies = 0;
    let command: string[] | undefined;
    const flush = () => {
        if (command) dependencies += Number(inspectCommand(command));
        command = undefined;
    };
    const finishSlice = () => {
        flush();
        if (slices && (!count || !dependencies)) throw failure();
    };
    for (const line of output.split("\n")) {
        if (!line) continue;
        if (header.test(line)) {
            finishSlice();
            slices++;
            count = 0;
            dependencies = 0;
            continue;
        }
        const start = /^Load command ([0-9]+)$/.exec(line);
        if (start) {
            if (!slices || Number(start[1]) !== count++) throw failure();
            flush();
            command = [];
        } else {
            if (!command) throw failure();
            command.push(line);
        }
    }
    finishSlice();
    if (!slices) throw failure();
}

/** Does not execute the input file. Caller must bind this inspection to a stable file identity. */
export async function assertSystemNativeDependencies(file: string): Promise<void> {
    if (process.platform === "linux") {
        try {
            return await assertLinuxSystemDependencies(file);
        } catch {
            throw failure();
        }
    }
    if (process.platform !== "darwin" || !path.isAbsolute(file) || /[\r\n\x00]/u.test(file)) {
        throw failure();
    }
    try {
        const handle = await open(
            file,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
            if (!(await handle.stat()).isFile()) throw failure();
            const bytes = Buffer.alloc(4);
            const read = await handle.read(bytes, 0, 4, 0);
            if (
                read.bytesRead !== 4 ||
                ![
                    "feedface",
                    "cefaedfe",
                    "feedfacf",
                    "cffaedfe",
                    "cafebabe",
                    "bebafeca",
                    "cafebabf",
                    "bfbafeca",
                ].includes(bytes.toString("hex"))
            )
                throw failure();
        } finally {
            await handle.close();
        }
        const result = await runFile("/usr/bin/otool", ["-arch", "all", "-l", file], {
            encoding: "utf8",
            timeout: 15_000,
            maxBuffer: 4 * 1024 * 1024,
            // otool 在裁剪环境中缺少 DARWIN_USER_TEMP_DIR 时会向 stderr 写警告；固定系统
            // 临时目录，既不继承调用者环境，也不把合法二进制误判为工具异常。
            env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TMPDIR: "/tmp" },
        });
        if (result.stderr.trim()) throw failure();
        assertDarwinSystemDependencies(result.stdout, file);
    } catch {
        // Avoid exposing source paths, tool diagnostics or embedded binary strings.
        throw failure();
    }
}
