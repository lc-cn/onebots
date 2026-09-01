import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectDoctorServiceStateDirectory } from "./doctor-service-state.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("doctor service state directory", () => {
    it("接受当前进程可遍历和读写的真实目录", () => {
        const directory = createTemporaryDirectory();

        expect(inspectDoctorServiceStateDirectory(directory)).toEqual({
            name: "service-permissions",
            level: "ok",
            message: `服务状态目录可读写: ${directory}`,
        });
    });

    it("拒绝普通文件冒充服务状态目录", () => {
        const directory = createTemporaryDirectory();
        const file = path.join(directory, "state");
        fs.writeFileSync(file, "not a directory", { mode: 0o600 });

        expect(inspectDoctorServiceStateDirectory(file)).toEqual({
            name: "service-permissions",
            level: "error",
            message: `服务状态路径不是目录: ${file}`,
        });
    });

    it("以路径级诊断报告缺失目录", () => {
        const missing = path.join(createTemporaryDirectory(), "missing");

        expect(inspectDoctorServiceStateDirectory(missing)).toEqual({
            name: "service-permissions",
            level: "error",
            message: `服务状态目录不可用: ${missing}`,
        });
    });

    it.runIf(process.platform !== "win32")("拒绝公开权限，并仅在明确修复时收紧", () => {
        const directory = createTemporaryDirectory();
        fs.chmodSync(directory, 0o755);

        expect(inspectDoctorServiceStateDirectory(directory)).toEqual({
            name: "service-permissions",
            level: "error",
            message: "服务状态目录权限 755 允许其他用户访问或同组用户修改（--fix 可收紧为 0700）",
        });
        expect(fs.statSync(directory).mode & 0o777).toBe(0o755);
        expect(inspectDoctorServiceStateDirectory(directory, true)).toEqual({
            name: "service-permissions",
            level: "ok",
            message: "已将服务状态目录权限从 755 收紧为 0700",
            fixed: true,
        });
        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    });

    it.runIf(process.platform !== "win32")("保留有意配置的同组只读访问", () => {
        const directory = createTemporaryDirectory();
        fs.chmodSync(directory, 0o750);

        expect(inspectDoctorServiceStateDirectory(directory, true)).toEqual({
            name: "service-permissions",
            level: "warning",
            message: "服务状态目录权限 750 允许同组用户访问；请确认日志共享是部署所需",
        });
        expect(fs.statSync(directory).mode & 0o777).toBe(0o750);
    });
});

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-service-state-"));
    temporaryDirectories.push(directory);
    return directory;
}
