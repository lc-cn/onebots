import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
const roots: string[] = [];
const script = path.resolve(import.meta.dirname, "../../../docs/public/install.sh");
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
function fixture(mode = "ok") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-install-script-"));
    roots.push(root);
    const bin = path.join(root, "bin"),
        home = path.join(root, ".onebots"),
        log = path.join(root, "commands");
    fs.mkdirSync(bin);
    const write = (name: string, value: string) =>
        fs.writeFileSync(path.join(bin, name), value, { mode: 0o755 });
    const cli = path.join(root, "fake-cli");
    fs.writeFileSync(
        cli,
        `#!/bin/sh
[ "$PWD" = ${quote(path.join(home, "runtime"))} ] || exit 8
printf 'cli %s\\n' "$*" >> ${quote(log)}
case "$1" in
 install) [ ${quote(mode)} != install-fail ] || exit 3 ;;
 start) [ ${quote(mode)} != start-fail ] || exit 3 ;;
 status)
  [ ${quote(mode)} != status-fail ] || exit 3
  if [ ${quote(mode)} = invalid-status ]; then printf '{}\\n'; else
   printf '%s\\n' '{"schemaVersion":1,"installation":"control","manager":{"state":"running","ipc":"available"},"serviceRecoveryRequired":false,"diagnostic":null,"gateway":{"actual":"stopped","desired":"stopped","recoveryRequired":false}}'
  fi ;;
 *) exit 9 ;;
esac
`,
    );
    const node = (version: number) => `#!/bin/sh
if [ "$1" = -p ]; then printf '${version}\\n'; exit 0; fi
if [ "$1" = --input-type=module ]; then exec ${quote(process.execPath)} "$@"; fi
exec /bin/sh "$@"
`;
    write("node", node(mode === "download" || mode === "bad-checksum" ? 18 : 24));
    write(
        "npm",
        `#!/bin/sh
printf 'npm %s\\n' "$*" >> ${quote(log)}
[ -z "\${NODE_AUTH_TOKEN:-}\${NPM_TOKEN:-}\${TAR_OPTIONS:-}\${NODE_OPTIONS:-}" ] || exit 8
[ "$HOME" = ${quote(path.join(home, ".bootstrap/home"))} ] || exit 8
[ -f "$NPM_CONFIG_USERCONFIG" ] && [ -f "$NPM_CONFIG_GLOBALCONFIG" ] || exit 8
[ ! -s "$NPM_CONFIG_USERCONFIG" ] && [ ! -s "$NPM_CONFIG_GLOBALCONFIG" ] || exit 8
[ ${quote(mode)} != npm-fail ] || exit 3
mkdir -p node_modules/onebots/lib/control node_modules/onebots/lib/gateway node_modules/@onebots/web/dist
cp ${quote(cli)} node_modules/onebots/lib/bin.js
if [ ${quote(mode)} != missing-host ]; then printf 'host' > node_modules/onebots/lib/control/host.js; fi
if [ ${quote(mode)} != missing-gateway ]; then printf 'gateway' > node_modules/onebots/lib/gateway/entry.js; fi
if [ ${quote(mode)} != missing-web ]; then printf '<html></html>' > node_modules/@onebots/web/dist/index.html; fi
`,
    );
    const platform = process.platform === "darwin" ? "darwin" : "linux";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const archiveName = `node-v24.4.0-${platform}-${arch}.tar.gz`;
    if (mode === "download" || mode === "bad-checksum") {
        const source = path.join(root, "download", archiveName.replace(/\.tar\.gz$/, ""), "bin");
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, "node"), node(24), { mode: 0o755 });
        fs.copyFileSync(path.join(bin, "npm"), path.join(source, "npm"));
        const archive = path.join(root, archiveName);
        execFileSync("tar", [
            "-czf",
            archive,
            "-C",
            path.join(root, "download"),
            archiveName.replace(/\.tar\.gz$/, ""),
        ]);
        const hash =
            mode === "bad-checksum"
                ? "0".repeat(64)
                : createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
        fs.writeFileSync(path.join(root, "checksums"), `${hash}  ${archiveName}\n`);
    }
    write(
        "curl",
        `#!/bin/sh
printf 'curl\\n' >> ${quote(log)}
url=''; target=''
while [ "$#" -gt 0 ]; do
 case "$1" in https:*) url=$1 ;; -o) shift; target=$1 ;; esac
 shift
done
case "$url" in
 */SHASUMS256.txt) cp ${quote(path.join(root, "checksums"))} "$target" ;;
 */${archiveName}) cp ${quote(path.join(root, archiveName))} "$target" ;;
 *) exit 7 ;;
esac
`,
    );
    const run = () =>
        spawnSync("/bin/sh", [script], {
            encoding: "utf8",
            env: {
                ...process.env,
                HOME: root,
                ONEBOTS_HOME: home,
                PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
                NODE_AUTH_TOKEN: "private-auth",
                NPM_TOKEN: "private-npm",
                NODE_OPTIONS: "",
                TAR_OPTIONS: "",
            },
        });
    return {
        root,
        home,
        log,
        run,
        commands: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
    };
}
it("首次空白安装只装管理程序，安装/启动/只读状态确认后引导设备配对", () => {
    const f = fixture();
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("管理服务已安装并确认运行");
    expect(f.commands()).toContain("--registry=https://registry.npmjs.org onebots@latest");
    expect(f.commands()).toContain(`cli install --data-dir ${f.home}`);
    expect(f.commands()).toContain("cli start\ncli status --json");
    expect(f.commands()).not.toMatch(
        /cli (setup|update|auth|ui|restart)|service-runtime|preflight/,
    );
    expect(fs.existsSync(path.join(f.home, "config.yaml"))).toBe(false);
    expect(result.stdout).toContain("auth bootstrap");
    expect(result.stdout).toContain("ui --data-dir");
    expect(result.stdout + result.stderr).not.toMatch(/private-auth|private-npm/);
});
it("成功重复执行不修改npm或重启", () => {
    const f = fixture();
    expect(f.run().status).toBe(0);
    const before = f.commands();
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("已有安装成功");
    expect(f.commands()).toBe(before);
});
it.each(["config.yaml", "runtime", "node"])("旧%s保持不变，不执行依赖安装", entry => {
    const f = fixture();
    fs.mkdirSync(f.home);
    const target = path.join(f.home, entry);
    if (entry === "config.yaml") fs.writeFileSync(target, "private-existing-config");
    else {
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "keep"), "old-runtime");
    }
    const before = fs.readdirSync(f.home);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("migrate");
    expect(f.commands()).toBe("");
    expect(fs.readdirSync(f.home)).toEqual(before);
    expect(
        fs.readFileSync(entry === "config.yaml" ? target : path.join(target, "keep"), "utf8"),
    ).toContain(entry === "config.yaml" ? "private-existing" : "old-runtime");
});
it.each(["missing-host", "missing-gateway", "missing-web"])(
    "缺少新架构工件%s不执行CLI且保留候选",
    mode => {
        const f = fixture(mode);
        const result = f.run();
        expect(result.status).not.toBe(0);
        expect(f.commands()).not.toContain("cli ");
        expect(fs.existsSync(path.join(f.home, "runtime"))).toBe(true);
        expect(fs.existsSync(path.join(f.home, ".manager-installed"))).toBe(false);
    },
);
it.each(["npm-fail", "install-fail", "start-fail", "status-fail", "invalid-status"])(
    "%s不宣告成功且不自动重试或回滚",
    mode => {
        const f = fixture(mode);
        const result = f.run();
        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("管理服务已安装并确认运行");
        expect(fs.existsSync(path.join(f.home, ".manager-installed"))).toBe(false);
        const before = f.commands();
        expect(f.run().status).not.toBe(0);
        expect(f.commands()).toBe(before);
    },
);
it("Node24下载经过摘要校验，测试完全使用合成文件而非网络", () => {
    const f = fixture("download");
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(f.commands().match(/curl/g)).toHaveLength(2);
    expect(fs.existsSync(path.join(f.home, "node/bin/node"))).toBe(true);
});
it("Node摘要不匹配不安装npm且不创建node目录", () => {
    const f = fixture("bad-checksum");
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("校验失败");
    expect(f.commands()).not.toContain("npm ");
    expect(fs.existsSync(path.join(f.home, "node"))).toBe(false);
});
it("既有安装锁和符号链接工作区均拒绝，不认领或清理他人目录", () => {
    const locked = fixture();
    fs.mkdirSync(locked.home);
    fs.mkdirSync(path.join(locked.home, ".install-lock"));
    expect(locked.run().status).not.toBe(0);
    expect(fs.existsSync(path.join(locked.home, ".install-lock"))).toBe(true);
    expect(locked.commands()).toBe("");
    const linked = fixture();
    const target = path.join(linked.root, "existing");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep"), "existing-data");
    fs.symlinkSync(target, linked.home);
    expect(linked.run().status).not.toBe(0);
    expect(fs.readdirSync(target)).toEqual(["keep"]);
    expect(linked.commands()).toBe("");
});
