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

it.each([true, false])("自动识别 Compose 部署并安全处理绑定目录（支持=%s）", supported => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-discovery-"));
    roots.push(root);
    const data = path.join(root, "data with spaces");
    fs.mkdirSync(data);
    const log = path.join(root, "calls");
    fs.writeFileSync(
        path.join(root, "docker"),
        `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_CALLS"
case "$*" in
  'compose ps -aq onebots') echo compose-gateway;;
  'inspect --format {{.Image}} compose-gateway') echo sha256:running;;
  'inspect --format {{range .Mounts}}'*) if [ "$TEST_SUPPORTED" = 1 ]; then printf '%s\\n' "$TEST_DATA"; fi;;
  'image inspect --format'*) echo sha256:running;;
  *'docker-extension-release.mjs current '*) echo installed-version;;
esac
`,
        { mode: 0o755 },
    );
    const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        TEST_CALLS: log,
        TEST_DATA: data,
        TEST_SUPPORTED: supported ? "1" : "0",
    };
    for (const key of ["ONEBOTS_DATA_DIR", "ONEBOTS_IMAGE", "ONEBOTS_CONTAINER_NAME"])
        delete env[key];
    const result = spawnSync("sh", ["scripts/docker-extensions.sh", "rollback", "--apply"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
    });
    expect(result.status).toBe(supported ? 0 : 1);
    const calls = fs.readFileSync(log, "utf8");
    if (supported) {
        expect(calls).toContain(`type=bind,src=${fs.realpathSync(data)}/extensions,dst=/data/extensions`);
        expect(calls).toMatch(
            /docker-extension-release.mjs rollback \/data\/extensions \S+ installed-version/,
        );
        expect(calls).toContain("restart compose-gateway");
        expect(calls).not.toContain("ghcr.io/lc-cn/onebots:master");
    } else {
        expect(calls).not.toContain("docker-extension-release.mjs init ");
        expect(calls).not.toContain("restart ");
    }
});
