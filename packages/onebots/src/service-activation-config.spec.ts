import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    assertServiceActivationConfigCurrent,
    captureServiceActivationConfig,
} from "./service-activation-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("service activation config snapshot", () => {
    it("accepts the unchanged file used by runtime preflight", () => {
        const config = createConfig();
        const snapshot = captureServiceActivationConfig(config);

        expect(() => assertServiceActivationConfigCurrent(config, snapshot)).not.toThrow();
    });

    it.skipIf(process.platform === "win32")(
        "rejects permission drift with unchanged content",
        () => {
            const config = createConfig();
            const snapshot = captureServiceActivationConfig(config);
            fs.chmodSync(config, 0o644);

            expect(() => assertServiceActivationConfigCurrent(config, snapshot)).toThrow(
                /配置权限在运行时预检后变得不安全.*644/u,
            );
        },
    );
});

function createConfig(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-activation-config-"));
    temporaryDirectories.push(directory);
    const config = path.join(directory, "config.yaml");
    fs.writeFileSync(config, "access_token: persisted-token\ngeneral: {}\n", { mode: 0o600 });
    return config;
}
