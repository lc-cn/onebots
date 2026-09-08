/** 验证真实 npm 安装产物；不安装系统服务，不使用平台凭据。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync("/tmp/ob-npm-");
const runtime = path.join(temporary, "runtime");
const workspace = path.join(temporary, "workspace");
const archives = path.join(temporary, "archives");
for (const directory of [runtime, archives]) fs.mkdirSync(directory, { mode: 0o700 });
const userconfig = path.join(temporary, "user.npmrc");
const globalconfig = path.join(temporary, "global.npmrc");
fs.writeFileSync(userconfig, "", { mode: 0o600 });
fs.writeFileSync(globalconfig, "", { mode: 0o600 });
const environment = {
    PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    LANG: "C",
    NPM_CONFIG_USERCONFIG: userconfig,
    NPM_CONFIG_GLOBALCONFIG: globalconfig,
    NPM_CONFIG_CACHE: path.join(temporary, "cache"),
};
let host;
let safeToRemove = true;
function execute(command, args, cwd, env) {
    try {
        return execFileSync(command, args, {
            cwd,
            env,
            encoding: "utf8",
            timeout: 180_000,
            maxBuffer: 4 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch {
        throw new Error(`验证命令失败：${command}；临时目录 ${temporary}`);
    }
}
try {
    for (const name of ["core", "web", "onebots"]) {
        execute(
            "pnpm",
            ["pack", "--pack-destination", archives],
            path.join(root, "packages", name),
            process.env,
        );
    }
    const tarballs = fs.readdirSync(archives).filter(name => name.endsWith(".tgz"));
    assert.equal(tarballs.length, 3);
    fs.writeFileSync(
        path.join(runtime, "package.json"),
        JSON.stringify({ name: "onebots-install-verification", version: "1.0.0", private: true }),
    );
    // 与引导脚本相同的npm安装限制；本地三个包替代尚未发布的管理程序，不重写归档内容。
    execute(
        "npm",
        [
            "install",
            "--omit=dev",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--save-exact",
            "--registry=https://registry.npmjs.org",
            ...tarballs.map(name => path.join(archives, name)),
        ],
        runtime,
        environment,
    );
    const packageRoot = path.join(runtime, "node_modules/onebots");
    for (const relative of ["lib/bin.js", "lib/control/host.js", "lib/gateway/entry.js"]) {
        assert.ok(fs.statSync(path.join(packageRoot, relative)).size > 0);
    }
    const { startControlHost } = await import(
        pathToFileURL(path.join(packageRoot, "lib/control/host.js")).href
    );
    const { createLocalControlClient } = await import(
        pathToFileURL(path.join(packageRoot, "lib/client/local-control.js")).href
    );
    const client = createLocalControlClient(workspace);
    const options = {
        workspace,
        port: 0,
        host: "127.0.0.1",
        runtimeRoot: runtime,
        gatewayEntrypoint: path.join(packageRoot, "lib/gateway/entry.js"),
    };
    safeToRemove = false;
    host = await startControlHost(options);
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const html = await page.text();
    const asset = html.match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
    assert.ok(asset, "真实安装包必须提供Web入口脚本");
    assert.equal(
        (await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(5000) })).status,
        200,
    );
    assert.equal(
        (await fetch(`${origin}/api/control/status`, { signal: AbortSignal.timeout(5000) })).status,
        401,
    );
    const catalog = await client.installationCatalog();
    assert.deepEqual(catalog.selection, { adapters: [], protocols: [], applications: [] });
    const started = await client.gateway("start");
    assert.equal(started.status, "succeeded");
    assert.equal((await client.status()).gateway.actual, "running");
    assert.equal((await client.gateway("stop")).status, "succeeded");
    assert.equal((await client.status()).gateway.actual, "stopped");
    assert.equal((await client.configurationSource()).state, "ready");
    await host.close();
    host = undefined;
    host = await startControlHost(options);
    assert.equal((await client.status()).gateway.desired, "stopped");
    assert.equal((await client.status()).gateway.actual, "stopped");
    await host.close();
    host = undefined;
    safeToRemove = true;
    process.stdout.write(
        "✓ 实际 npm 产物：Web入口及资源、匿名控制拒绝、零扩展、网关启停和停止意图跨重启保持通过（未安装原生系统服务）\n",
    );
} finally {
    if (host) {
        await host.close();
        safeToRemove = true;
    }
    if (safeToRemove) fs.rmSync(temporary, { recursive: true, force: true });
    else process.stderr.write(`验证状态未确认，保留临时目录 ${temporary}\n`);
}
