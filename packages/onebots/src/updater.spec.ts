import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServiceSpec } from "./service-manager.js";
import { refreshServiceAfterUpdate, runUpdatedServicePreflight } from "./updater.js";

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
