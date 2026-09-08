import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it.each(["download", "verify"])("Docker %s 失败保留错误码、释放锁且不激活候选版本", phase => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-coordinator-"));
    roots.push(root);
    const log = path.join(root, "calls");
    fs.writeFileSync(
        path.join(root, "docker"),
        `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_CALLS"
case "$*" in
  'image inspect --format'*) echo sha256:fixture;;
  *'docker-extension-release.mjs plan '*) echo '{}';;
  *"docker-extension-installer.mjs $TEST_FAIL_PHASE "*) exit 37;;
esac
`,
        { mode: 0o755 },
    );
    const result = spawnSync("sh", ["scripts/docker-extensions.sh", "install", "telegram"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            ONEBOTS_DATA_DIR: path.join(root, "data"),
            TEST_CALLS: log,
            TEST_FAIL_PHASE: phase,
        },
    });
    expect(result.status).toBe(37);
    const calls = fs.readFileSync(log, "utf8");
    expect(calls).toContain("docker-extension-installer.mjs download ");
    expect(calls).toContain("docker-extension-release.mjs unlock ");
    expect(calls).not.toContain("docker-extension-release.mjs activate ");
    if (phase === "download") expect(calls).not.toContain("docker-extension-installer.mjs verify ");
});
