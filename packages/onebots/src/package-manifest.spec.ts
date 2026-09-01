import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectPackageManifest } from "./package-manifest.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("package manifest boundary", () => {
    it.skipIf(process.platform === "win32")("拒绝只把 package.json 链接到实际包根外", () => {
        const root = temporaryDirectory();
        const packageRoot = path.join(root, "package");
        fs.mkdirSync(packageRoot);
        const externalManifest = path.join(root, "external-package.json");
        fs.writeFileSync(externalManifest, JSON.stringify({ name: "substituted" }));
        const manifestPath = path.join(packageRoot, "package.json");
        fs.symlinkSync(externalManifest, manifestPath);

        expect(inspectPackageManifest(manifestPath)).toEqual({
            valid: false,
            error: `package.json 解析到实际包目录外: ${externalManifest}`,
        });
    });

    it.skipIf(process.platform === "win32")("允许整个包目录由 workspace 软链接提供", () => {
        const root = temporaryDirectory();
        const packageRoot = path.join(root, "workspace-package");
        fs.mkdirSync(packageRoot);
        fs.writeFileSync(
            path.join(packageRoot, "package.json"),
            JSON.stringify({ name: "workspace-package", version: "1.0.0" }),
        );
        const linkedRoot = path.join(root, "node_modules", "workspace-package");
        fs.mkdirSync(path.dirname(linkedRoot));
        fs.symlinkSync(packageRoot, linkedRoot);

        expect(inspectPackageManifest(path.join(linkedRoot, "package.json"))).toMatchObject({
            valid: true,
            manifest: { name: "workspace-package", version: "1.0.0" },
            path: fs.realpathSync(path.join(packageRoot, "package.json")),
        });
    });
});

function temporaryDirectory(): string {
    const directory = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "onebots-package-manifest-")),
    );
    temporaryDirectories.push(directory);
    return directory;
}
