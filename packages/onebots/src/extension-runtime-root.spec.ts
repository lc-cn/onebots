import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
import { inspectExtensionRuntimeRoot } from "./extension-runtime-root.js";

describe("inspectExtensionRuntimeRoot", () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("接受身份和版本匹配且可写的运行目录", () => {
        const root = createRuntimeRoot({
            name: packageMetadata.name,
            version: packageMetadata.version,
        });
        const access = vi.fn();

        expect(inspectExtensionRuntimeRoot(root, { access })).toEqual({
            root,
            version: packageMetadata.version,
            error: null,
        });
        expect(access).toHaveBeenCalledWith(root, fs.constants.W_OK);
        expect(access).not.toHaveBeenCalledWith(path.join(root, "node_modules"), fs.constants.W_OK);
    });

    it("在检查身份或写权限前拒绝超大运行目录清单", () => {
        const root = createRuntimeRoot({ private: true });
        fs.writeFileSync(path.join(root, "package.json"), Buffer.alloc(1024 * 1024 + 1, 0x20));
        const access = vi.fn();

        expect(inspectExtensionRuntimeRoot(root, { access })).toEqual({
            root,
            version: null,
            error: expect.stringContaining("package.json 超过 1048576 字节上限"),
        });
        expect(access).not.toHaveBeenCalled();
    });

    it("在运行目录不可写时拒绝安装目标", () => {
        const root = createRuntimeRoot({
            name: packageMetadata.name,
            version: packageMetadata.version,
        });

        const inspection = inspectExtensionRuntimeRoot(root, {
            access: target => {
                if (target === root) throw new Error("EACCES");
            },
        });

        expect(inspection).toEqual({
            root,
            version: null,
            error: `扩展运行目录不可写：${root}。请调整目录属主或权限后重试。`,
        });
    });

    it("在已有依赖目录不可写时拒绝安装目标", () => {
        const root = createRuntimeRoot({
            private: true,
            dependencies: { onebots: packageMetadata.version },
        });
        const dependenciesRoot = path.join(root, "node_modules");
        fs.mkdirSync(path.join(dependenciesRoot, "onebots"), { recursive: true });
        fs.writeFileSync(
            path.join(dependenciesRoot, "onebots", "package.json"),
            JSON.stringify({ name: packageMetadata.name, version: packageMetadata.version }),
        );

        const inspection = inspectExtensionRuntimeRoot(root, {
            access: target => {
                if (target === dependenciesRoot) throw new Error("EACCES");
            },
        });

        expect(inspection).toEqual({
            root,
            version: null,
            error: `扩展依赖目录不可写：${dependenciesRoot}。请调整目录属主或权限后重试。`,
        });
    });

    function createRuntimeRoot(manifest: object): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-extension-runtime-root-"));
        temporaryDirectories.push(root);
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
        return root;
    }
});
