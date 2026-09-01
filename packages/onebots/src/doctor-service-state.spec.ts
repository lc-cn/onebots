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
});

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-service-state-"));
    temporaryDirectories.push(directory);
    return directory;
}
