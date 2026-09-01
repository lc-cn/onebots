import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectServiceEntry } from "./doctor-service-entry.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("doctor service entry", () => {
    it("验证入口包身份、版本和 bin 声明", () => {
        const { entryPath } = servicePackage("1.2.8");

        expect(inspectServiceEntry(entryPath, "1.2.8")).toEqual({
            valid: true,
            check: {
                name: "service-entry",
                level: "ok",
                message: `服务入口 onebots@1.2.8: ${entryPath}`,
            },
        });
    });

    it.runIf(process.platform !== "win32")("从 npm bin 符号链接追溯真实包入口", () => {
        const { entryPath } = servicePackage("1.2.8");
        const linkRoot = fs.realpathSync(
            fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-link-")),
        );
        temporaryDirectories.push(linkRoot);
        const linkedEntry = path.join(linkRoot, "onebots");
        fs.symlinkSync(entryPath, linkedEntry);

        expect(inspectServiceEntry(linkedEntry, "1.2.8")).toMatchObject({
            valid: true,
            check: { message: `服务入口 onebots@1.2.8: ${entryPath}` },
        });
    });

    it("拒绝仍存在的旧版 OneBots 入口", () => {
        const { entryPath, manifestPath } = servicePackage("1.2.7");

        expect(inspectServiceEntry(entryPath, "1.2.8")).toEqual({
            valid: false,
            check: {
                name: "service-entry",
                level: "error",
                message: `服务入口版本错配，期望 onebots@1.2.8，实际 onebots@1.2.7: ${manifestPath}`,
            },
        });
    });

    it("拒绝未由 bin.onebots 声明的同包脚本", () => {
        const { root } = servicePackage("1.2.8");
        const unrelated = path.join(root, "lib", "other.js");
        fs.writeFileSync(unrelated, "");

        expect(inspectServiceEntry(unrelated, "1.2.8")).toMatchObject({
            valid: false,
            check: {
                name: "service-entry",
                level: "error",
                message: `服务入口与 bin.onebots 声明不一致: ${unrelated}`,
            },
        });
    });

    it("损坏 manifest 时不回显原始 JSON", () => {
        const { entryPath, manifestPath } = servicePackage("1.2.8");
        fs.writeFileSync(manifestPath, '{"access_token":"secret-token",');

        const inspection = inspectServiceEntry(entryPath, "1.2.8");
        expect(inspection).toMatchObject({ valid: false });
        expect(inspection.check.message).toContain(manifestPath);
        expect(inspection.check.message).not.toContain("secret-token");
    });

    it("拒绝从超大 manifest 证明服务入口身份", () => {
        const { entryPath, manifestPath } = servicePackage("1.2.8");
        fs.writeFileSync(manifestPath, Buffer.alloc(1024 * 1024 + 1, 0x20));

        const inspection = inspectServiceEntry(entryPath, "1.2.8");
        expect(inspection).toMatchObject({ valid: false });
        expect(inspection.check.message).toContain("package.json 超过 1048576 字节上限");
    });
});

function servicePackage(version: string) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-entry-")));
    temporaryDirectories.push(root);
    const entryPath = path.join(root, "lib", "bin.js");
    const manifestPath = path.join(root, "package.json");
    fs.mkdirSync(path.dirname(entryPath));
    fs.writeFileSync(entryPath, "");
    fs.writeFileSync(
        manifestPath,
        JSON.stringify({ name: "onebots", version, bin: { onebots: "./lib/bin.js" } }),
    );
    return { root, entryPath, manifestPath };
}
