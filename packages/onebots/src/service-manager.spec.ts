import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceController, type ServiceSpec } from "./service-manager.js";
import type { ServiceHost } from "./service-host.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.runIf(process.platform !== "win32")("service definition persistence", () => {
    it("原子替换并收紧既有 systemd unit 的危险权限", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-manager-"));
        temporaryDirectories.push(root);
        const host = linuxHost(root);
        const controller = new ServiceController("user", host);
        const spec: ServiceSpec = {
            scope: "user",
            configPath: path.join(root, "config.yaml"),
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            nodePath: "/opt/node/bin/node",
            binPath: "/opt/onebots/lib/bin.js",
            workingDirectory: root,
        };

        await controller.install(spec);
        const definition = controller.paths().definition;
        expect(fs.statSync(definition).mode & 0o777).toBe(0o644);
        expect(controller.definitionIsCurrent(spec)).toBe(true);

        fs.chmodSync(definition, 0o666);
        await controller.install(spec);

        expect(fs.statSync(definition).mode & 0o777).toBe(0o644);
        expect(controller.definitionIsCurrent(spec)).toBe(true);
        expect(fs.readdirSync(path.dirname(definition))).toEqual([path.basename(definition)]);
    });
});

function linuxHost(root: string): ServiceHost {
    return {
        platform: "linux",
        homedir: root,
        uid: 501,
        env: {
            XDG_STATE_HOME: path.join(root, "state"),
            XDG_CONFIG_HOME: path.join(root, "config"),
        },
        exec: vi.fn(() => ""),
        spawn: vi.fn(async () => 0),
    };
}
