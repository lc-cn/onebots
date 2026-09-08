import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { downloadGeneration, recoverDownloadCredentials } from "./generation-download.js";

const roots: string[] = [];
const parents: ChildProcess[] = [];
afterEach(async () => {
    // 先请求本次夹具自行退出；不根据磁盘里读出的历史 PID 发信号。
    const pendingRoots = roots.splice(0);
    const failures: unknown[] = [];
    const workers: number[] = [];
    const downloads = new Map<string, number>();
    for (const root of pendingRoots) {
        try {
            const running = await report(path.join(root, "candidate"));
            if (Number.isSafeInteger(running.pid) && running.pid > 0)
                downloads.set(root, running.pid);
            const owner = JSON.parse(await readFile(path.join(running.home, "owner.json"), "utf8"));
            if (Number.isSafeInteger(owner.workerPid) && owner.workerPid > 0)
                workers.push(owner.workerPid);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(error);
        }
        try {
            await writeFile(path.join(root, "fixture-stop"), "stop");
        } catch (error) {
            failures.push(error);
        }
    }
    for (const child of parents.splice(0)) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try {
            const exited = once(child, "exit");
            child.kill("SIGKILL"); // 仅持有本测试 spawn 返回的 ChildProcess。
            await exited;
        } catch (error) {
            failures.push(error);
        }
    }
    for (const pid of workers) {
        try {
            await waitGone(pid);
        } catch (error) {
            failures.push(error);
        }
    }
    for (const root of pendingRoots) {
        try {
            const names = await readdir(root);
            if (downloads.has(root)) await waitGone(downloads.get(root)!);
            else if (names.includes("fixture-active")) {
                for (let attempt = 0; ; attempt++) {
                    if ((await readdir(root)).includes("fixture-exited")) break;
                    if (attempt > 500) throw new Error("本次下载夹具尚未退出，保留临时目录");
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            if (!failures.length) await rm(root, { recursive: true, force: true });
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length) throw new AggregateError(failures, "下载夹具清理未确认，保留现场");
});
async function waitGone(pid: number) {
    for (let attempt = 0; ; attempt++) {
        try {
            process.kill(pid, 0);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
            throw error;
        }
        if (attempt > 500) throw new Error("下载进程尚未退出，保留临时目录");
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

async function fixture(mode = "success") {
    const root = await mkdtemp(path.join(os.tmpdir(), "onebots-download-test-"));
    roots.push(root);
    const directory = path.join(root, "candidate");
    await mkdir(directory);
    const script = path.join(root, "pnpm.mjs");
    await writeFile(
        script,
        `
import { readFileSync, writeFileSync, renameSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) {
 process.stdout.write(${JSON.stringify(mode)} === 'wrong-version' ? '12.3.4' : '9.15.9');
 process.exit(0);
}
const fixtureRoot = path.dirname(process.argv[1]);
writeFileSync(path.join(fixtureRoot, 'fixture-active'), 'active');
process.on('exit', () => writeFileSync(path.join(fixtureRoot, 'fixture-exited'), 'exited'));
const cleanupTimer = setInterval(() => {
 if (existsSync(path.join(fixtureRoot, 'fixture-stop'))) process.exit(0);
}, 10);
cleanupTimer.unref();
function publishReport(value) {
 writeFileSync('report.json.tmp', JSON.stringify(value));
 renameSync('report.json.tmp', 'report.json');
}
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const auth = process.env.NPM_CONFIG_USERCONFIG;
const config = readFileSync(auth, 'utf8');
const report = {
 pid: process.pid, args, home: process.env.HOME, auth, authMode: statSync(auth).mode & 0o777,
 tokenInAuth: config.includes('github_pat_test_secret'),
 scopeOnly: config.includes('@icqqjs:registry=https://npm.pkg.github.com/'),
 leakedEnv: Object.keys(process.env).filter(key => /(?:TOKEN|SECRET|NODE_OPTIONS|npm_config_registry|HTTP_PROXY)/.test(key)),
 rawParentConfig: config.includes('parent-secret'),
};
// 模拟包管理器收到恶意生命周期脚本；缺少ignore-scripts将真实运行它。
if (!args.includes('--ignore-scripts') && manifest.scripts?.postinstall) {
 spawnSync(process.execPath, ['-e', manifest.scripts.postinstall]);
}
if (${JSON.stringify(mode)} === 'failure') {
 publishReport(report);
 process.stdout.write(config); process.stderr.write('github_pat_test_secret parent-secret'); process.exit(1);
}
if (${JSON.stringify(mode)} === 'stubborn') {
 process.on('SIGTERM', () => {});
 setInterval(() => {}, 1000);
} else if (${JSON.stringify(mode)} === 'cancel') {
 process.on('SIGTERM', () => {
   writeFileSync('termination.json', JSON.stringify({authStillExists: existsSync(auth)}));
   setTimeout(() => process.exit(0), 100);
 });
 setInterval(() => {}, 1000);
} else {
 writeFileSync('pnpm-lock.yaml', 'lockfileVersion: 9.0\\n');
}
publishReport(report);
`,
    );
    return { root, directory, script };
}

const manifest = {
    packageManager: "pnpm@9.15.9",
    name: "onebots-candidate",
    private: true,
    type: "module",
    dependencies: { onebots: "1.2.12" },
    scripts: { postinstall: "require('node:fs').writeFileSync('malicious-marker', 'executed')" },
};

async function report(directory: string) {
    return JSON.parse(await readFile(path.join(directory, "report.json"), "utf8"));
}

describe("不可变候选下载执行器", () => {
    it("worker被强杀时不删存活下载授权，下载进程退出后冷恢复才能清理", async () => {
        const { root, directory, script } = await fixture("cancel");
        const parentEntry = path.join(root, "parent.mjs");
        const source = new URL("./generation-download.ts", import.meta.url).href;
        await writeFile(
            parentEntry,
            `import {downloadGeneration} from ${JSON.stringify(source)};
await downloadGeneration(${JSON.stringify({ directory, manifest, token: "github_pat_test_secret", pnpmExecutable: process.execPath, pnpmScript: script })});`,
        );
        const parent = spawn(
            process.execPath,
            ["--import", import.meta.resolve("tsx/esm"), parentEntry],
            { stdio: "ignore" },
        );
        parents.push(parent);
        for (let attempt = 0; ; attempt++) {
            if ((await readdir(directory)).includes("report.json")) break;
            if (attempt > 500) throw new Error("下载夹具未就绪");
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        const running = await report(directory);
        const owner = JSON.parse(await readFile(path.join(running.home, "owner.json"), "utf8"));
        const exited = once(parent, "exit");
        process.kill(owner.workerPid, "SIGKILL");
        await exited;
        const credentialRoot = path.dirname(running.home);
        try {
            expect(await recoverDownloadCredentials(credentialRoot)).toEqual({
                removed: [],
                blocked: [owner.id],
            });
            expect(await readFile(running.auth, "utf8")).toContain("github_pat_test_secret");
        } finally {
            process.kill(running.pid, "SIGTERM");
            await waitGone(running.pid);
        }
        expect(await recoverDownloadCredentials(credentialRoot)).toEqual({
            removed: [owner.id],
            blocked: [],
        });
        await expect(readFile(running.auth)).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("管理父进程被 SIGKILL 后 worker 回收下载进程并清除私有授权", async () => {
        const { root, directory, script } = await fixture("cancel");
        const parentEntry = path.join(root, "parent.mjs");
        const source = new URL("./generation-download.ts", import.meta.url).href;
        await writeFile(
            parentEntry,
            `import {downloadGeneration} from ${JSON.stringify(source)};
await downloadGeneration(${JSON.stringify({ directory, manifest, token: "github_pat_test_secret", pnpmExecutable: process.execPath, pnpmScript: script })});`,
        );
        const parent = spawn(
            process.execPath,
            ["--import", import.meta.resolve("tsx/esm"), parentEntry],
            { stdio: "ignore" },
        );
        parents.push(parent);
        for (let attempt = 0; ; attempt++) {
            if ((await readdir(directory)).includes("report.json")) break;
            if (attempt > 500) throw new Error("下载夹具未就绪");
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        const running = await report(directory);
        const owner = JSON.parse(await readFile(path.join(running.home, "owner.json"), "utf8"));
        const exited = once(parent, "exit");
        parent.kill("SIGKILL");
        await exited;
        for (let attempt = 0; ; attempt++) {
            try {
                await readdir(running.home);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
                throw error;
            }
            if (attempt > 500) throw new Error("父进程退出后授权目录未清理");
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(() => process.kill(running.pid, 0)).toThrow();
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                process.kill(owner.workerPid, 0);
            } catch {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("下载 worker 未退出");
    });
    it("实际执行器版本不符时拒绝下载，不因 PATH 名称正确而继续", async () => {
        const { directory, script } = await fixture("wrong-version");
        await expect(
            downloadGeneration({
                directory,
                manifest,
                token: "github_pat_test_secret",
                pnpmExecutable: process.execPath,
                pnpmScript: script,
            }),
        ).rejects.toMatchObject({ code: "PACKAGE_MANAGER_MISMATCH" });
        expect(await readdir(directory)).toEqual(["package.json"]);
    });
    it("超时强制回收忽略 SIGTERM 的下载进程后清理授权", async () => {
        const { directory, script } = await fixture("stubborn");
        const started = Date.now();
        await expect(
            downloadGeneration({
                directory,
                manifest,
                token: "github_pat_test_secret",
                pnpmExecutable: process.execPath,
                pnpmScript: script,
                timeoutMs: 200,
            }),
        ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
        expect(Date.now() - started).toBeLessThan(5_000);
        const result = await report(directory);
        await expect(readFile(result.auth)).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("使用固定安全参数、独立授权环境并清理Token，忽略真实恶意生命周期脚本", async () => {
        const { directory, script } = await fixture();
        const previous = process.env.ONEBOTS_ACCESS_TOKEN;
        const npmConfig = process.env.npm_config_registry;
        process.env.ONEBOTS_ACCESS_TOKEN = "parent-secret";
        process.env.npm_config_registry = "https://untrusted.invalid";
        try {
            await downloadGeneration({
                directory,
                manifest,
                token: "github_pat_test_secret",
                pnpmExecutable: process.execPath,
                pnpmScript: script,
            });
        } finally {
            if (previous === undefined) delete process.env.ONEBOTS_ACCESS_TOKEN;
            else process.env.ONEBOTS_ACCESS_TOKEN = previous;
            if (npmConfig === undefined) delete process.env.npm_config_registry;
            else process.env.npm_config_registry = npmConfig;
        }
        const result = await report(directory);
        expect(result.args).toEqual(
            expect.arrayContaining([
                "install",
                "--prod",
                "--ignore-scripts",
                "--ignore-pnpmfile",
                "--ignore-workspace",
                "--config.strict-peer-dependencies=false",
                "--config.auto-install-peers=true",
            ]),
        );
        expect(result.authMode).toBe(0o600);
        expect(result.tokenInAuth).toBe(true);
        expect(result.scopeOnly).toBe(true);
        expect(result.leakedEnv).toEqual([]);
        expect(result.rawParentConfig).toBe(false);
        expect(await readdir(directory)).not.toContain("malicious-marker");
        await expect(readFile(result.auth)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readdir(result.home)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("下载失败丢弃原始输出和错误上下文，清理临时授权", async () => {
        const { directory, script } = await fixture("failure");
        await expect(
            downloadGeneration({
                directory,
                manifest,
                token: "github_pat_test_secret",
                pnpmExecutable: process.execPath,
                pnpmScript: script,
            }),
        ).rejects.toMatchObject({
            code: "DOWNLOAD_FAILED",
            message: "依赖下载失败，请检查网络、仓库授权和依赖版本",
        });
        const result = await report(directory);
        await expect(readFile(result.auth)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("取消等待真实长进程退出后才清除凭据", async () => {
        const { directory, script } = await fixture("cancel");
        const controller = new AbortController();
        const download = downloadGeneration({
            directory,
            manifest,
            signal: controller.signal,
            token: "github_pat_test_secret",
            pnpmExecutable: process.execPath,
            pnpmScript: script,
        });
        const outcome = download.then(
            () => "unexpected-success",
            error => error.code,
        );
        for (let attempt = 0; attempt < 100; attempt++) {
            if ((await readdir(directory)).includes("report.json")) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        controller.abort();
        expect(await outcome).toBe("CANCELLED");
        const terminated = JSON.parse(
            await readFile(path.join(directory, "termination.json"), "utf8"),
        );
        expect(terminated.authStillExists).toBe(true);
        const result = await report(directory);
        await expect(readFile(result.auth)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("拒绝重复候选、npmrc残留、凭据注入和.cmd shell入口", async () => {
        const { directory, script } = await fixture();
        const input = { directory, manifest, pnpmExecutable: process.execPath, pnpmScript: script };
        await expect(
            downloadGeneration({ ...input, token: "bad\nregistry=evil" }),
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
        await expect(
            downloadGeneration({ ...input, pnpmExecutable: "pnpm.cmd" }),
        ).rejects.toMatchObject({ code: "UNSUPPORTED_EXECUTABLE" });
        await writeFile(path.join(directory, ".npmrc"), "registry=evil");
        await expect(downloadGeneration(input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
        expect(await readdir(directory)).toEqual([".npmrc"]);
    });

    it("预取消不写候选manifest也不启动下载", async () => {
        const { directory, script } = await fixture();
        const controller = new AbortController();
        controller.abort();
        await expect(
            downloadGeneration({
                directory,
                manifest,
                signal: controller.signal,
                pnpmExecutable: process.execPath,
                pnpmScript: script,
            }),
        ).rejects.toMatchObject({ code: "CANCELLED" });
        expect(await readdir(directory)).toEqual([]);
    });
});
