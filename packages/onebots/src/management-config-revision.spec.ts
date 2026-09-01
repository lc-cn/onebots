import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    assertManagementConfigRevisionPrecondition,
    createManagementConfigRevision,
    ManagementConfigRevisionMismatchError,
} from "./management-config-revision.js";

describe("management config revision", () => {
    it("为相同正文生成稳定且有命名空间的摘要", () => {
        const revision = createManagementConfigRevision("port: 6727\n");
        expect(revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(createManagementConfigRevision("port: 6727\n")).toBe(revision);
        expect(createManagementConfigRevision("port: 7000\n")).not.toBe(revision);
    });

    it("拒绝已经被其他管理操作更新的旧配置", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-revision-"));
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "port: 7000\n");
        try {
            expect(() =>
                assertManagementConfigRevisionPrecondition(
                    { get: () => createManagementConfigRevision("port: 6727\n") },
                    "配置保存",
                    configPath,
                ),
            ).toThrow(ManagementConfigRevisionMismatchError);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
