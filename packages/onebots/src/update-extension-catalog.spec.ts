import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadTargetExtensionVersionCatalog } from "./update-extension-catalog.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("update extension catalog source", () => {
    it.each([
        {
            manifest: { name: "substituted-package", version: "1.3.0" },
            message: "暂存包身份错配：期望 onebots，实际 substituted-package",
        },
        {
            manifest: { name: "onebots", version: "1.2.9" },
            message: "暂存包版本错配：期望 onebots@1.3.0，实际 1.2.9",
        },
    ])("拒绝无法证明目标 OneBots 身份的暂存目录", ({ manifest, message }) => {
        const root = createRuntimeRoot();
        installFakeNpm(root, manifest, "9.9.9");

        expect(() => loadTargetExtensionVersionCatalog("npm", root, "1.3.0", null)).toThrow(
            message,
        );
    });

    it("不把当前安装的版本与另一安装的目录拼接为证据", () => {
        const root = createRuntimeRoot();
        writePackage(root, "onebots", "1.3.0", null);
        const foreignRoot = path.join(root, "foreign");
        const foreignEntry = path.join(foreignRoot, "node_modules", "onebots", "lib", "bin.js");
        writePackage(foreignRoot, "onebots", "1.2.9", "8.8.8");
        fs.writeFileSync(foreignEntry, "", "utf8");
        const marker = path.join(root, "staged.txt");
        installFakeNpm(root, { name: "onebots", version: "1.3.0" }, "2.5.0", marker);

        expect(
            loadTargetExtensionVersionCatalog("npm", root, "1.3.0", "1.3.0", foreignEntry),
        ).toEqual({
            schemaVersion: 2,
            packages: { "@onebots/adapter-mock": { version: "2.5.0" } },
        });
        expect(fs.readFileSync(marker, "utf8")).toBe("staged");
    });
});

function createRuntimeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-catalog-"));
    temporaryDirectories.push(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"private":true}\n', "utf8");
    return root;
}

function writePackage(
    root: string,
    name: string,
    version: string,
    adapterVersion: string | null,
): void {
    const packageRoot = path.join(root, "node_modules", "onebots");
    fs.mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
    fs.writeFileSync(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name, version }),
        "utf8",
    );
    if (adapterVersion) {
        fs.writeFileSync(
            path.join(packageRoot, "lib", "extension-capability-catalog.json"),
            JSON.stringify({
                schemaVersion: 2,
                packages: { "@onebots/adapter-mock": { version: adapterVersion } },
            }),
            "utf8",
        );
    }
}

function installFakeNpm(
    root: string,
    manifest: { name: string; version: string },
    adapterVersion: string,
    marker?: string,
): void {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(
        path.join(bin, "npm"),
        `#!/bin/sh
mkdir -p node_modules/onebots/lib
cat > node_modules/onebots/package.json <<'EOF'
${JSON.stringify(manifest)}
EOF
cat > node_modules/onebots/lib/extension-capability-catalog.json <<'EOF'
{"schemaVersion":2,"packages":{"@onebots/adapter-mock":{"version":"${adapterVersion}"}}}
EOF
${marker ? 'printf staged > "$UPDATE_CATALOG_MARKER"' : ""}
`,
        { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    if (marker) vi.stubEnv("UPDATE_CATALOG_MARKER", marker);
}
