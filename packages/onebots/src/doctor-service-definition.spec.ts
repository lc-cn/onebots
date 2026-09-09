import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectServiceDefinitionDirectoryPermissions } from "./doctor-service-definition.js";
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("doctor service platform definition", () => {
    it.runIf(process.platform !== "win32")("拒绝可替换服务定义路径的父目录", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-definition-dir-"));
        temporaryDirectories.push(directory);
        fs.chmodSync(directory, 0o770);

        expect(
            inspectServiceDefinitionDirectoryPermissions(path.join(directory, "onebots.service")),
        ).toEqual({
            name: "service-definition-dir-mode",
            level: "error",
            message:
                "服务定义目录权限 770 允许组或其他用户替换服务定义；请由目录所有者移除对应写权限",
        });
    });
});
