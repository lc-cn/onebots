import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    preparePreviousVersionArtifacts,
    previousSyntheticVersion,
} from "../../scripts/manager-upgrade-acceptance-helpers.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function execute(command: string, args: string[]) {
    assert.equal(command, "tar", "fixture may only invoke local archive tooling");
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, "local fixture archive command failed");
}
const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

it.each([
    ["2.0.0", "1.0.0"],
    ["1.3.0", "1.2.0"],
    ["1.2.19", "1.2.18"],
    ["0.1.0", "0.0.0"],
    ["0.0.1", "0.0.0"],
    ["9007199254740991.0.0", "9007199254740990.0.0"],
])("constructs only a lower synthetic stable label for %s", (target, expected) => {
    expect(previousSyntheticVersion(target)).toBe(expected);
});

it.each([
    "0.0.0",
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "-1.2.3",
    "v1.2.3",
    "1.2.3-beta.1",
    "1.2.3+metadata",
    "1.2.3\n",
    "9007199254740992.0.0",
    "1.9007199254740992.0",
    "1.2.9007199254740992",
    undefined,
    123,
    {},
])("rejects an unsupported version before archive commands or directory creation: %j", version => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-invalid-version-")));
    roots.push(root);
    const command = vi.fn();
    expect(() =>
        preparePreviousVersionArtifacts({
            temporary: root,
            artifacts: "unused",
            manifest: { host: { version } },
            execute: command,
        }),
    ).toThrow();
    expect(command).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
});

it("repacks a 2.0.0 synthetic artifact as a strictly earlier version without changing code or source archives", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-acceptance-version-")));
    roots.push(root);
    const artifacts = path.join(root, "artifacts");
    const source = path.join(root, "source");
    const packageRoot = path.join(source, "package");
    fs.mkdirSync(path.join(packageRoot, "lib/control"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(artifacts, { mode: 0o700 });
    const packageJson = { name: "onebots", version: "2.0.0", type: "module", bin: "lib/bin.js" };
    const code = "export const WORKSPACE_ADMISSION_CAPABILITY = 1;\n";
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify(packageJson));
    fs.writeFileSync(path.join(packageRoot, "lib/control/host.js"), code);
    fs.writeFileSync(path.join(packageRoot, "lib/bin.js"), "export {};\n");
    const hostFile = "onebots-2.0.0.tgz";
    execute("tar", ["-czf", path.join(artifacts, hostFile), "-C", source, "package"]);
    const coreFile = "onebots-core-1.0.0.tgz";
    const coreSource = path.join(root, "core-source");
    fs.mkdirSync(path.join(coreSource, "package"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
        path.join(coreSource, "package/package.json"),
        JSON.stringify({ name: "@onebots/core", version: "1.0.0", type: "module" }),
    );
    execute("tar", ["-czf", path.join(artifacts, coreFile), "-C", coreSource, "package"]);
    const hostDigest = sha256(path.join(artifacts, hostFile));
    const coreDigest = sha256(path.join(artifacts, coreFile));
    const manifest = {
        host: { name: "onebots", version: "2.0.0", file: hostFile, sha256: hostDigest },
        core: { name: "@onebots/core", version: "1.0.0", file: coreFile, sha256: coreDigest },
        extensions: [],
    };
    const originalManifest = structuredClone(manifest);
    const result = preparePreviousVersionArtifacts({
        temporary: root,
        artifacts,
        manifest,
        execute,
    });
    expect(result.previousVersion).toBe("1.0.0");
    const previous = JSON.parse(fs.readFileSync(result.manifestFile, "utf8"));
    expect(previous.host.version).toBe("1.0.0");
    expect(previous.host.sha256).toBe(
        sha256(path.join(path.dirname(result.manifestFile), previous.host.file)),
    );
    expect(previous.core).toEqual(manifest.core);
    expect(sha256(path.join(path.dirname(result.manifestFile), coreFile))).toBe(coreDigest);
    const unpacked = path.join(root, "unpacked");
    fs.mkdirSync(unpacked);
    execute("tar", [
        "-xzf",
        path.join(path.dirname(result.manifestFile), previous.host.file),
        "-C",
        unpacked,
    ]);
    expect(
        JSON.parse(fs.readFileSync(path.join(unpacked, "package/package.json"), "utf8")),
    ).toEqual({ ...packageJson, version: "1.0.0" });
    expect(fs.readFileSync(path.join(unpacked, "package/lib/control/host.js"), "utf8")).toBe(code);
    expect(fs.readFileSync(path.join(unpacked, "package/lib/bin.js"), "utf8")).toBe("export {};\n");
    expect(result.installTarballs.sort()).toEqual(
        [
            path.join(artifacts, coreFile),
            path.join(path.dirname(result.manifestFile), previous.host.file),
        ].sort(),
    );
    expect(sha256(path.join(artifacts, hostFile))).toBe(hostDigest);
    expect(manifest).toEqual(originalManifest);
});
