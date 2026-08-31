import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    buildExtensionInstallInvocation,
    detectRuntimePackageManager,
    sanitizeNpmEnvironment,
} from "./package-manager.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture(manifest: object = { private: true }): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-package-manager-"));
    directories.push(root);
    fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(manifest)}\n`);
    return root;
}

describe("runtime package manager", () => {
    it("在 OneBots pnpm workspace 中安装扩展时不调用会解析 catalog: 的 npm", () => {
        const invocation = buildExtensionInstallInvocation(
            process.cwd(),
            "@onebots/protocol-mcp-v1",
            "darwin",
            {},
        );

        expect(invocation).toMatchObject({
            executable: "pnpm",
            args: ["add", "--save-prod", "--workspace-root", "@onebots/protocol-mcp-v1@latest"],
        });
    });

    it("独立 npm 运行目录继续使用 npm 并省略开发依赖", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });
        const invocation = buildExtensionInstallInvocation(root, "@onebots/adapter-slack");

        expect(invocation.executable).toBe("npm");
        expect(invocation.args).toEqual([
            "install",
            "--save",
            "--omit=dev",
            "@onebots/adapter-slack@latest",
        ]);
    });

    it("锁文件优先于启动进程环境决定运行目录的包管理器", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });
        fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

        expect(detectRuntimePackageManager(root)).toBe("pnpm");
    });

    it("转调 npm 时移除 pnpm 专用配置并保留凭据和标准 npm 配置", () => {
        const source = {
            NODE_AUTH_TOKEN: "secret",
            npm_config_registry: "https://registry.npmjs.org",
            npm_config_recursive: "true",
            npm_config_global_bin_dir: "/tmp/pnpm-bin",
            npm_config_node_version: "24.0.0",
            npm_config_store_dir: "/tmp/pnpm-store",
            npm_config_only_built_dependencies: "esbuild",
            npm_config__icqqjs_registry: "https://npm.pkg.github.com",
        };

        expect(sanitizeNpmEnvironment(source)).toEqual({
            NODE_AUTH_TOKEN: "secret",
            npm_config_registry: "https://registry.npmjs.org",
        });
        expect(source.npm_config_recursive).toBe("true");
    });
});
