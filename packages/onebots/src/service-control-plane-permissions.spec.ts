import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inspectServiceControlPlanePermissions } from "./service-control-plane-permissions.js";
import type { ServiceController, ServiceSpec } from "./service-manager.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.skipIf(process.platform === "win32")("service control-plane permissions", () => {
    it("collects every unsafe lifecycle path as structured evidence", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-control-plane-"));
        temporaryDirectories.push(root);
        const stateDir = path.join(root, "state");
        const definitionDir = path.join(root, "definition");
        const metadata = path.join(stateDir, "service.json");
        const definition = path.join(definitionDir, "onebots.service");
        fs.mkdirSync(stateDir, { mode: 0o770 });
        fs.mkdirSync(definitionDir, { mode: 0o775 });
        fs.writeFileSync(metadata, "{}", { mode: 0o660 });
        fs.writeFileSync(definition, "service", { mode: 0o664 });
        fs.chmodSync(stateDir, 0o770);
        fs.chmodSync(definitionDir, 0o775);
        fs.chmodSync(metadata, 0o660);
        fs.chmodSync(definition, 0o664);

        const controller = {
            paths: () => ({ stateDir, metadata, definition }),
            definitionPath: () => definition,
        } satisfies Pick<ServiceController, "definitionPath" | "paths">;
        const checks = inspectServiceControlPlanePermissions(controller, {} as ServiceSpec);

        expect(checks.filter(check => check.level === "error").map(check => check.name)).toEqual([
            "service-permissions",
            "service-metadata-mode",
            "service-definition-mode",
            "service-definition-dir-mode",
        ]);
    });
});
