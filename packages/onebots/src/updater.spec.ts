import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServiceSpec } from "./service-manager.js";
import {
    packageNamesFor,
    refreshServiceAfterUpdate,
    resolveUpdatePluginSelection,
    runUpdatedServicePreflight,
} from "./updater.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function temporaryServiceSpec(): ServiceSpec {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-preflight-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, "general: {}\n", "utf8");
    return {
        scope: "user",
        configPath,
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        nodePath: process.execPath,
        binPath: path.join(directory, "updated-cli.mjs"),
        workingDirectory: directory,
    };
}

function fakeController(running: boolean) {
    return {
        status: vi.fn(() => ({ running })),
        install: vi.fn(async (_spec: ServiceSpec) => undefined),
        restart: vi.fn(async () => undefined),
    };
}

describe("post-update service safety", () => {
    it("使用当前配置中的 Web 后装插件覆盖过期服务快照", () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(
            spec.configPath,
            "plugins:\n  adapters: [slack, telegram]\n  protocols: [milky-v1]\ngeneral: {}\n",
        );

        const selection = resolveUpdatePluginSelection({ adapters: [], protocols: [] }, spec);

        expect(selection).toEqual({
            adapters: ["slack", "telegram"],
            protocols: ["milky-v1"],
        });
        expect(packageNamesFor(selection.adapters, selection.protocols)).toEqual([
            "onebots",
            "@onebots/adapter-slack",
            "@onebots/adapter-telegram",
            "@onebots/protocol-milky-v1",
        ]);
    });

    it("按类别保留显式参数，并让另一类别使用当前配置", () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(
            spec.configPath,
            "plugins:\n  adapters: [slack]\n  protocols: [milky-v1]\ngeneral: {}\n",
        );

        expect(
            resolveUpdatePluginSelection({ adapters: ["telegram"], protocols: [] }, spec),
        ).toEqual({ adapters: ["telegram"], protocols: ["milky-v1"] });
    });

    it("旧配置缺少 plugins 时回退服务快照", () => {
        const spec = temporaryServiceSpec();

        expect(resolveUpdatePluginSelection({ adapters: [], protocols: [] }, spec)).toEqual({
            adapters: ["mock"],
            protocols: ["onebot-v11"],
        });
    });

    it("当前配置的插件选择损坏时拒绝使用过期快照", () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(spec.configPath, "plugins:\n  adapters: invalid\n", "utf8");

        expect(() => resolveUpdatePluginSelection({ adapters: [], protocols: [] }, spec)).toThrow(
            "plugins.adapters 必须是字符串数组",
        );
    });

    it("does not rewrite or restart the service when the updated runtime fails preflight", async () => {
        const controller = fakeController(true);
        const spec = temporaryServiceSpec();
        const confirmRestart = vi.fn(async () => true);

        await expect(
            refreshServiceAfterUpdate(controller, spec, true, {
                preflight: async () => {
                    throw new Error("updated plugin failed");
                },
                confirmRestart,
            }),
        ).rejects.toThrow(/软件包已更新.*服务定义与当前运行实例保持不变.*updated plugin failed/);
        expect(controller.install).not.toHaveBeenCalled();
        expect(controller.restart).not.toHaveBeenCalled();
        expect(confirmRestart).not.toHaveBeenCalled();
    });

    it("rewrites and restarts a running service only after preflight succeeds", async () => {
        const controller = fakeController(true);
        const spec = temporaryServiceSpec();
        const order: string[] = [];
        controller.install.mockImplementation(async () => {
            order.push("install");
        });
        controller.restart.mockImplementation(async () => {
            order.push("restart");
        });

        await refreshServiceAfterUpdate(controller, spec, true, {
            preflight: async () => {
                order.push("preflight");
            },
            confirmRestart: vi.fn(async () => false),
        });

        expect(order).toEqual(["preflight", "install", "restart"]);
    });

    it("launches the saved updated CLI in the service working directory", () => {
        const spec = temporaryServiceSpec();
        const marker = path.join(spec.workingDirectory, "invocation.json");
        fs.writeFileSync(
            spec.binPath,
            `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
`,
            "utf8",
        );

        runUpdatedServicePreflight(spec);

        expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({
            argv: [
                "--service-runtime",
                "preflight",
                "-c",
                spec.configPath,
                "-r",
                "mock",
                "-p",
                "onebot-v11",
            ],
            cwd: fs.realpathSync(spec.workingDirectory),
        });
    });
});
