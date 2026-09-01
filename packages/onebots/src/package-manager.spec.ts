import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    buildExtensionInstallInvocation,
    buildExtensionRestoreInvocation,
    buildPackageManagerInvocation,
    buildPackageRemovalInvocation,
    buildPackageUpdateInvocation,
    capturePackageManagerMetadata,
    detectRuntimePackageManager,
    hasPackageManagerMetadataChanged,
    inspectRuntimePackageManager,
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
    it("从 workspace 证据根捕获依赖声明与锁文件变化", () => {
        const root = fixture({ packageManager: "pnpm@9.15.9" });
        fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: ['packages/*']\n");
        fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        const member = path.join(root, "packages", "gateway");
        fs.mkdirSync(member, { recursive: true });
        fs.writeFileSync(path.join(member, "package.json"), JSON.stringify({ private: true }));

        const snapshot = capturePackageManagerMetadata(member);

        expect(snapshot.root).toBe(fs.realpathSync(root));
        expect(hasPackageManagerMetadataChanged(snapshot)).toBe(false);
        fs.appendFileSync(path.join(root, "pnpm-lock.yaml"), "packages: {}\n");
        expect(hasPackageManagerMetadataChanged(snapshot)).toBe(true);

        const updatedSnapshot = capturePackageManagerMetadata(member);
        fs.writeFileSync(
            path.join(member, "package.json"),
            JSON.stringify({ private: true, dependencies: { onebots: "partial" } }),
        );
        expect(hasPackageManagerMetadataChanged(updatedSnapshot)).toBe(true);
    });

    it("识别包管理器新建此前不存在的内部锁文件", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });
        const snapshot = capturePackageManagerMetadata(root);

        fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
        fs.writeFileSync(path.join(root, "node_modules", ".package-lock.json"), "{}\n");

        expect(hasPackageManagerMetadataChanged(snapshot)).toBe(true);
    });

    it("证明运行目录选出的包管理器在 PATH 中具有可执行入口", () => {
        const root = fixture({ packageManager: "pnpm@9.15.9" });
        const access = vi.fn((target: string) => {
            if (target !== path.join(root, "tools", "pnpm")) throw new Error("ENOENT");
        });

        expect(
            inspectRuntimePackageManager(root, { PATH: "missing:tools" }, "linux", access),
        ).toEqual({
            manager: "pnpm",
            executable: "pnpm",
            resolvedPath: path.join(root, "tools", "pnpm"),
            error: null,
        });
        expect(access).toHaveBeenLastCalledWith(
            path.join(root, "tools", "pnpm"),
            fs.constants.X_OK,
        );
    });

    it("缺少所选包管理器时返回可操作诊断", () => {
        const root = fixture({ packageManager: "pnpm@9.15.9" });

        expect(
            inspectRuntimePackageManager(root, { PATH: "missing" }, "linux", () => {
                throw new Error("ENOENT");
            }),
        ).toEqual({
            manager: "pnpm",
            executable: "pnpm",
            resolvedPath: null,
            error: "扩展运行目录需要 pnpm，但当前进程的 PATH 中找不到可执行入口。请安装 pnpm 或通过 corepack 激活后重启 OneBots。",
        });
    });

    it("Windows 使用大小写不敏感的 Path 和 cmd 入口", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });

        expect(
            inspectRuntimePackageManager(root, { Path: '"C:/Node"' }, "win32", () => undefined),
        ).toMatchObject({
            manager: "npm",
            executable: "npm.cmd",
            resolvedPath: path.resolve(root, "C:/Node", "npm.cmd"),
            error: null,
        });
    });

    it("在 OneBots pnpm workspace 中安装扩展时不调用会解析 catalog: 的 npm", () => {
        const invocation = buildExtensionInstallInvocation(
            process.cwd(),
            "@onebots/protocol-mcp-v1@0.1.5",
            "darwin",
            {},
        );

        expect(invocation).toMatchObject({
            executable: "pnpm",
            args: ["add", "--save-prod", "--workspace-root", "@onebots/protocol-mcp-v1@0.1.5"],
        });
    });

    it("独立 npm 运行目录继续使用 npm 并省略开发依赖", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });
        const invocation = buildExtensionInstallInvocation(root, "@onebots/adapter-slack@3.0.8");

        expect(invocation.executable).toBe("npm");
        expect(invocation.args).toEqual([
            "install",
            "--save",
            "--omit=dev",
            "@onebots/adapter-slack@3.0.8",
        ]);
    });

    it("按原状态生成扩展恢复命令", () => {
        const npmRoot = fixture({ packageManager: "npm@11.17.0" });
        expect(
            buildExtensionRestoreInvocation(
                npmRoot,
                "@onebots/adapter-slack",
                "3.0.7",
                "darwin",
                {},
            ),
        ).toEqual({
            executable: "npm",
            args: ["install", "--save", "--omit=dev", "@onebots/adapter-slack@3.0.7"],
            environment: {},
        });

        const pnpmRoot = fixture({ packageManager: "pnpm@9.15.9" });
        fs.writeFileSync(path.join(pnpmRoot, "pnpm-workspace.yaml"), "packages: []\n");
        expect(
            buildExtensionRestoreInvocation(pnpmRoot, "@onebots/adapter-slack", null, "linux", {}),
        ).toEqual({
            executable: "pnpm",
            args: ["remove", "--workspace-root", "@onebots/adapter-slack"],
            environment: {},
        });
    });

    it("锁文件优先于启动进程环境决定运行目录的包管理器", () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

        expect(
            detectRuntimePackageManager(root, {
                npm_execpath: "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
            }),
        ).toBe("pnpm");
    });

    it("同层 npm 与 pnpm 证据冲突时在生成安装命令前失败", () => {
        const root = fixture({ packageManager: "pnpm@9.15.9" });
        fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");

        expect(inspectRuntimePackageManager(root, {}, "linux", () => undefined)).toEqual({
            manager: null,
            executable: null,
            resolvedPath: null,
            error: expect.stringMatching(
                /包管理器证据冲突.*package-lock\.json.*packageManager=pnpm@9\.15\.9/,
            ),
        });
        expect(() => buildExtensionInstallInvocation(root, "@onebots/adapter-slack@3.0.8")).toThrow(
            /包管理器证据冲突/,
        );
        expect(() => buildPackageUpdateInvocation(root, ["onebots@1.2.9"], root)).toThrow(
            /包管理器证据冲突/,
        );
    });

    it("拒绝 Yarn、Bun 与无效 packageManager 声明而不降级为 npm", () => {
        const yarnRoot = fixture({ packageManager: "yarn@4.9.2" });
        fs.writeFileSync(path.join(yarnRoot, "yarn.lock"), "# yarn lock\n");
        const yarnError = inspectRuntimePackageManager(yarnRoot).error;
        expect(yarnError).toContain("尚不支持的包管理器");
        expect(yarnError).toContain("packageManager=yarn@4.9.2");
        expect(yarnError).toContain("yarn.lock");
        expect(() => detectRuntimePackageManager(yarnRoot)).toThrow(/尚不支持的包管理器/);

        const invalidRoot = fixture({ packageManager: 42 });
        expect(inspectRuntimePackageManager(invalidRoot).error).toBe(
            `packageManager 声明无效: ${path.join(fs.realpathSync(invalidRoot), "package.json")}`,
        );
        const incompleteRoot = fixture({ packageManager: "pnpm" });
        expect(inspectRuntimePackageManager(incompleteRoot).error).toBe(
            `packageManager 声明无效: ${path.join(fs.realpathSync(incompleteRoot), "package.json")}`,
        );
    });

    it("没有项目证据时拒绝从 Yarn 启动的进程", () => {
        const root = fixture();

        expect(
            inspectRuntimePackageManager(root, {
                npm_execpath: "/opt/corepack/yarn.js",
                npm_config_user_agent: "yarn/4.9.2 npm/? node/v24.0.0",
            }).error,
        ).toBe(
            "当前进程由 OneBots 尚不支持的包管理器 yarn 启动，且项目没有明确的 npm/pnpm 证据。请改用 npm 或 pnpm 启动。",
        );
    });

    it("从 workspace 成员目录直接启动时沿目录向上识别 pnpm", () => {
        const root = fixture({ packageManager: "pnpm@9.15.9" });
        fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
        const member = path.join(root, "apps", "gateway");
        fs.mkdirSync(member, { recursive: true });
        fs.writeFileSync(
            path.join(member, "package.json"),
            `${JSON.stringify({ dependencies: { onebots: "workspace:*" } })}\n`,
        );

        const invocation = buildExtensionInstallInvocation(
            member,
            "@onebots/adapter-slack@3.0.8",
            "darwin",
            {},
        );

        expect(invocation).toEqual({
            executable: "pnpm",
            args: ["add", "--save-prod", "@onebots/adapter-slack@3.0.8"],
            environment: {},
        });
    });

    it.runIf(process.platform !== "win32")(
        "通过符号链接部署 workspace 成员时按真实路径识别 pnpm",
        () => {
            const root = fixture({ packageManager: "pnpm@9.15.9" });
            fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: ['apps/*']\n");
            const member = path.join(root, "apps", "gateway");
            fs.mkdirSync(member, { recursive: true });
            fs.writeFileSync(
                path.join(member, "package.json"),
                `${JSON.stringify({ dependencies: { onebots: "workspace:*" } })}\n`,
            );
            const links = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-package-manager-link-"));
            directories.push(links);
            const linkedRuntime = path.join(links, "gateway");
            fs.symlinkSync(member, linkedRuntime, "dir");

            expect(
                buildExtensionInstallInvocation(
                    linkedRuntime,
                    "@onebots/protocol-mcp-v1@0.1.5",
                    "darwin",
                    { npm_config_user_agent: "npm/11.0.0 node/v24.0.0" },
                ),
            ).toEqual({
                executable: "pnpm",
                args: ["add", "--save-prod", "@onebots/protocol-mcp-v1@0.1.5"],
                environment: { npm_config_user_agent: "npm/11.0.0 node/v24.0.0" },
            });
        },
    );

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

    it("npm 项目更新省略开发依赖并清理继承的 pnpm 配置", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });
        const environment = {
            npm_config_recursive: "true",
            npm_config_registry: "https://registry.npmjs.org",
        };

        expect(
            buildPackageUpdateInvocation(
                root,
                ["onebots@latest", "@onebots/adapter-slack@latest"],
                root,
                "darwin",
                environment,
            ),
        ).toEqual({
            executable: "npm",
            args: [
                "install",
                "--save",
                "--omit=dev",
                "onebots@latest",
                "@onebots/adapter-slack@latest",
            ],
            cwd: root,
            environment: { npm_config_registry: "https://registry.npmjs.org" },
        });
    });

    it("Windows 更新和版本查询使用 cmd 入口", () => {
        const root = fixture({ packageManager: "npm@11.17.0" });

        expect(buildPackageUpdateInvocation(root, ["onebots@latest"], null, "win32", {})).toEqual({
            executable: "npm.cmd",
            args: ["install", "--global", "onebots@latest"],
            cwd: root,
            environment: {},
        });
        expect(
            buildPackageManagerInvocation("pnpm", ["view", "onebots", "version"], "win32", {}),
        ).toEqual({
            executable: "pnpm.cmd",
            args: ["view", "onebots", "version"],
            environment: {},
        });
    });

    it("pnpm 项目与全局更新保持原有命令语义", () => {
        const root = fixture({ packageManager: "pnpm@9.15.9" });

        expect(buildPackageUpdateInvocation(root, ["onebots@latest"], root, "linux", {})).toEqual({
            executable: "pnpm",
            args: ["up", "onebots@latest"],
            cwd: root,
            environment: {},
        });
        expect(buildPackageUpdateInvocation(root, ["onebots@latest"], null, "linux", {})).toEqual({
            executable: "pnpm",
            args: ["add", "--global", "onebots@latest"],
            cwd: root,
            environment: {},
        });
        expect(
            buildPackageRemovalInvocation(root, ["@onebots/adapter-slack"], root, "linux", {}),
        ).toEqual({
            executable: "pnpm",
            args: ["remove", "@onebots/adapter-slack"],
            cwd: root,
            environment: {},
        });
        expect(
            buildPackageRemovalInvocation(root, ["@onebots/adapter-slack"], null, "linux", {}),
        ).toEqual({
            executable: "pnpm",
            args: ["remove", "--global", "@onebots/adapter-slack"],
            cwd: root,
            environment: {},
        });
    });
});
