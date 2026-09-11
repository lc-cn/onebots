import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    assertDarwinSystemDependencies,
    assertSystemNativeDependencies,
} from "./service-migration-native-dependencies.js";

const file = "/fixture/node";
const error = "无法确认旧运行文件仅依赖系统原生库，已拒绝迁移";
const directories: string[] = [];
afterEach(() =>
    directories.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })),
);
const library = (name = "/usr/lib/libSystem.B.dylib", command = "LC_LOAD_DYLIB") =>
    `      cmd ${command}\n  cmdsize 256\n     name ${name} (offset 24)\n   time stamp 2 Thu Jan  1 00:00:02 1970\n      current version 1.0.0\ncompatibility version 1.0.0`;
const loader = "      cmd LC_LOAD_DYLINKER\n  cmdsize 32\n     name /usr/lib/dyld (offset 12)";
const slice = (commands: string[], arch?: string) =>
    `${file}${arch ? ` (architecture ${arch})` : ""}:\n${commands.map((body, i) => `Load command ${i}\n${body}`).join("\n")}\n`;

describe("macOS 原生依赖静态输出解析", () => {
    it("接受每个切片均仅加载系统库的通用二进制", () => {
        const output =
            slice([loader, library()], "x86_64") +
            slice(
                [
                    loader,
                    library("/System/Library/Frameworks/Security.framework/Versions/A/Security"),
                ],
                "arm64",
            );
        expect(() => assertDarwinSystemDependencies(output, file)).not.toThrow();
    });
    it.each([
        "LC_LOAD_DYLIB",
        "LC_LOAD_WEAK_DYLIB",
        "LC_REEXPORT_DYLIB",
        "LC_LOAD_UPWARD_DYLIB",
        "LC_LAZY_LOAD_DYLIB",
    ])("检查 %s 依赖", command => {
        expect(() =>
            assertDarwinSystemDependencies(slice([library(undefined, command)]), file),
        ).not.toThrow();
        expect(() =>
            assertDarwinSystemDependencies(
                slice([library("@rpath/libforeign.dylib", command)]),
                file,
            ),
        ).toThrow(error);
    });
    it.each([
        "@rpath/libicu.dylib",
        "@loader_path/libfoo.dylib",
        "@executable_path/libfoo.dylib",
        "/opt/homebrew/lib/libicu.dylib",
        "/usr/local/lib/libfoo.dylib",
        "libfoo.dylib",
        "/usr/lib/../../tmp/evil.dylib",
        "/usr/lib//libfoo.dylib",
        "/System/Library/../evil",
        "/usr/lib/",
        "/usr/lib/evil library.dylib",
    ])("拒绝未封闭依赖 %s", dependency => {
        expect(() => assertDarwinSystemDependencies(slice([library(dependency)]), file)).toThrow(
            error,
        );
    });
    it.each([
        "      cmd LC_RPATH\n  cmdsize 32\n     path /usr/lib (offset 12)",
        "      cmd LC_DYLD_ENVIRONMENT\n  cmdsize 64\n     name DYLD_INSERT_LIBRARIES=x (offset 12)",
        "      cmd LC_LOAD_DYLINKER\n  cmdsize 64\n     name /tmp/dyld (offset 12)",
        "      cmd LC_UNKNOWN\n  cmdsize 8",
        library().replace("offset 24", "offset 32"),
        library().replace("cmdsize 256", "cmdsize 24"),
        library() + "\n      cmd LC_RPATH",
    ])("拒绝路径搜索、未知或损坏命令 %#", command => {
        expect(() => assertDarwinSystemDependencies(slice([library(), command]), file)).toThrow(
            error,
        );
    });
    it("不会只检查通用二进制的第一个切片", () => {
        const output =
            slice([library()], "x86_64") + slice([library("/opt/homebrew/lib/evil")], "arm64");
        expect(() => assertDarwinSystemDependencies(output, file)).toThrow(error);
    });
    it.each([
        "",
        `${file}:\n`,
        "not an object file",
        slice([loader]),
        slice([library()]).replace("Load command 0", "Load command 1"),
        slice([library()]) + "/usr/bin/otool: malformed object\n",
        slice([library()]) + `${file} (architecture arm64):\n`,
        slice([library()]).replace("current version 1.0.0", "current version invalid"),
        slice([library()]).replace("compatibility version 1.0.0", ""),
        slice([library()]).replace("LC_LOAD_DYLIB", "0x800000ff"),
    ])("拒绝不完整或无法识别的输出 %#", output => {
        expect(() => assertDarwinSystemDependencies(output, file)).toThrow(error);
    });
});

describe("原生库只读检查", () => {
    it.skipIf(process.platform !== "darwin")("使用真实 otool 检查本机 Node 所有切片", async () => {
        // 本机 Node 若依赖 Homebrew 等外部库，此测试应失败，不能冒充已支持。
        await expect(
            assertSystemNativeDependencies(realpathSync(process.execPath)),
        ).resolves.toBeUndefined();
    });
    it("非二进制和缺失文件固定错误，不泄露内容或路径", async () => {
        const root = mkdtempSync(path.join(tmpdir(), "onebots-native-check-"));
        directories.push(root);
        const script = path.join(root, "secret-name");
        writeFileSync(script, "#!/bin/sh\necho DO_NOT_EXECUTE\n");
        await expect(assertSystemNativeDependencies(script)).rejects.toThrow(error);
        await expect(assertSystemNativeDependencies(path.join(root, "missing"))).rejects.toThrow(
            error,
        );
    });
    it.skipIf(["darwin", "linux"].includes(process.platform))(
        "未实现的宿主平台明确拒绝",
        async () => {
            await expect(assertSystemNativeDependencies(process.execPath)).rejects.toThrow(error);
        },
    );
});
