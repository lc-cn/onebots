import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installPackages } from "../installation-local.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-tui-install-test-"));
    roots.push(root);
    return root;
}

function installFixture(root: string, spec: string) {
    const separator = spec.lastIndexOf("@");
    const name = spec.slice(0, separator);
    const directory = path.join(root, "node_modules", name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
            name,
            version: spec.slice(separator + 1),
            type: "module",
            main: "index.js",
        }),
    );
    fs.writeFileSync(path.join(directory, "index.js"), "export {};\n");
}

describe("TUI 包安装执行边界", () => {
    it("凭据只交给子进程，临时文件不含 Token 明文，安装后清理且不修改已有 npmrc", async () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, ".npmrc"), "registry=https://registry.npmjs.org\n");
        let userconfig = "";
        await installPackages(
            ["@onebots/adapter-test@1.0.0"],
            root,
            "private-fixture-token",
            async (invocation, target) => {
                userconfig = invocation.environment.NPM_CONFIG_USERCONFIG;
                expect(invocation.environment.ONEBOTS_INSTALL_GITHUB_TOKEN).toBe(
                    "private-fixture-token",
                );
                expect(invocation.args.join(" ")).not.toContain("private-fixture-token");
                const content = fs.readFileSync(userconfig, "utf8");
                expect(content).toContain("${ONEBOTS_INSTALL_GITHUB_TOKEN}");
                expect(content).not.toContain("private-fixture-token");
                if (process.platform !== "win32")
                    expect(fs.statSync(userconfig).mode & 0o777).toBe(0o600);
                installFixture(target, invocation.args.at(-1));
            },
        );
        expect(fs.existsSync(userconfig)).toBe(false);
        expect(fs.existsSync(path.join(root, ".onebots-package-mutation.lock"))).toBe(false);
        expect(fs.readFileSync(path.join(root, ".npmrc"), "utf8")).toBe(
            "registry=https://registry.npmjs.org\n",
        );
        expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).not.toContain(
            "private-fixture-token",
        );
    });

    it("失败时也清理凭据文件和安装锁，并脱敏安装输出", async () => {
        const root = fixture();
        let userconfig = "";
        await expect(
            installPackages(
                ["@onebots/adapter-test@1.0.0"],
                root,
                "private-fixture-token",
                async invocation => {
                    userconfig = invocation.environment.NPM_CONFIG_USERCONFIG;
                    throw new Error("E403 private-fixture-token");
                },
            ),
        ).rejects.toThrow(/read:packages/);
        expect(fs.existsSync(userconfig)).toBe(false);
        expect(fs.existsSync(path.join(root, ".onebots-package-mutation.lock"))).toBe(false);
        expect(fs.existsSync(path.join(root, "config.yaml"))).toBe(false);
    });

    it("peer 版本冲突提示修复依赖，不误报网络或允许继续启动", async () => {
        const root = fixture();
        await expect(
            installPackages(["@onebots/adapter-test@1.0.0"], root, "", async () => {
                throw new Error("ERR_PNPM_PEER_DEP_ISSUES invalid sdk");
            }),
        ).rejects.toThrow("peerDependencies");
        expect(fs.existsSync(path.join(root, "config.yaml"))).toBe(false);
    });

    it("pnpm workspace 使用 pnpm 而非 npm，且校验安装的实际版本", async () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
        await expect(
            installPackages(
                ["@onebots/adapter-test@1.0.0"],
                root,
                "",
                async (invocation, target) => {
                    expect(invocation.executable).toMatch(/pnpm/);
                    expect(invocation.args).toContain("--workspace-root");
                    const spec = invocation.args.at(-1);
                    installFixture(target, `${spec.slice(0, spec.lastIndexOf("@"))}@0.0.0`);
                },
            ),
        ).rejects.toThrow("版本不匹配");
    });
});
