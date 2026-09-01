import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inspectPersistedCredentialPermissions } from "./persisted-credential-permissions.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.skipIf(process.platform === "win32")("persisted credential path permissions", () => {
    it("rejects a replaceable symlink entry even when its target is private", () => {
        const root = createDirectory("onebots-config-link-");
        const entryDirectory = path.join(root, "entry");
        const targetDirectory = path.join(root, "target");
        fs.mkdirSync(entryDirectory, { mode: 0o770 });
        fs.mkdirSync(targetDirectory, { mode: 0o700 });
        fs.chmodSync(entryDirectory, 0o770);
        const target = path.join(targetDirectory, "config.yaml");
        const link = path.join(entryDirectory, "config.yaml");
        fs.writeFileSync(target, "access_token: persisted-token\n", { mode: 0o600 });
        fs.symlinkSync(target, link);

        expect(inspectPersistedCredentialPermissions(link)).toContainEqual({
            name: "config-entry-dir-mode",
            level: "error",
            message: expect.stringMatching(/符号链接入口.*权限 770.*替换配置路径组件/u),
        });
    });

    it("rejects a replaceable ancestor directory link", () => {
        const root = createDirectory("onebots-config-ancestor-link-");
        const entryDirectory = path.join(root, "entry");
        const targetDirectory = path.join(root, "target");
        fs.mkdirSync(entryDirectory, { mode: 0o770 });
        fs.mkdirSync(targetDirectory, { mode: 0o700 });
        fs.chmodSync(entryDirectory, 0o770);
        const linkedDirectory = path.join(entryDirectory, "current");
        fs.symlinkSync(targetDirectory, linkedDirectory);
        const config = path.join(targetDirectory, "config.yaml");
        fs.writeFileSync(config, "access_token: persisted-token\n", { mode: 0o600 });

        expect(
            inspectPersistedCredentialPermissions(path.join(linkedDirectory, "config.yaml")),
        ).toContainEqual({
            name: "config-entry-dir-mode",
            level: "error",
            message: expect.stringMatching(/符号链接入口.*权限 770.*替换配置路径组件/u),
        });
    });

    it("does not duplicate entry evidence when configured and real directories match", () => {
        const directory = createDirectory("onebots-config-direct-");
        const config = path.join(directory, "config.yaml");
        fs.writeFileSync(config, "access_token: persisted-token\n", { mode: 0o600 });

        expect(inspectPersistedCredentialPermissions(config).map(check => check.name)).toEqual([
            "config-mode",
            "config-dir-mode",
        ]);
    });
});

function createDirectory(prefix: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
}
