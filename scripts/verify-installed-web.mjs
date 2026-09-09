/**
 * Pack and production-install the published management runtime, then drive its actual Web UI
 * through a real Chromium browser. The browser performs pairing and a gateway restart; the
 * installed CLI independently verifies that the manager survived and the gateway instance changed.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync("/tmp/ob-installed-web-");
const archives = path.join(temporary, "archives");
const runtime = path.join(temporary, "runtime");
const workspace = path.join(temporary, "workspace");
const browserProfile = path.join(temporary, "browser");
for (const directory of [archives, runtime, workspace, browserProfile])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

const packageSources = new Map([
    ["@onebots/core", path.join(root, "packages/core")],
    ["@onebots/web", path.join(root, "packages/web")],
    ["onebots", path.join(root, "packages/onebots")],
]);
const environment = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: path.join(temporary, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: path.join(temporary, "global-npmrc"),
    NPM_CONFIG_CACHE: path.join(temporary, "npm-cache"),
};
fs.writeFileSync(environment.NPM_CONFIG_USERCONFIG, "", { mode: 0o600 });
fs.writeFileSync(environment.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });

function findBrowser() {
    const executableNames = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ];
    const fromPath = (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap(directory => executableNames.map(name => path.join(directory, name)));
    const candidates = [
        process.env.CHROME_BIN,
        ...fromPath,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ].filter(Boolean);
    const browser = [...new Set(candidates)].find(candidate => {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
    if (!browser)
        throw new Error("未找到 Chrome/Chromium；CI 必须提供真实浏览器，不能跳过 Web 管理端验收");
    return browser;
}

async function waitFor(read, description, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const result = await read();
            if (result) return result;
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(
        `${description}超时${lastError instanceof Error ? `：${lastError.message}` : ""}`,
    );
}

class DevToolsSession {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", () => reject(new Error("浏览器调试连接失败")), {
                once: true,
            });
        });
        this.socket.addEventListener("message", event => {
            const message = JSON.parse(event.data);
            if (!message.id) return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
        });
        this.socket.addEventListener("close", () => {
            for (const pending of this.pending.values())
                pending.reject(new Error("浏览器调试连接已关闭"));
            this.pending.clear();
        });
    }

    async send(method, params = {}) {
        await this.ready;
        const id = this.nextId++;
        const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.socket.send(JSON.stringify({ id, method, params }));
        return result;
    }

    async evaluate(expression) {
        const result = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails)
            throw new Error(result.exceptionDetails.exception?.description ?? "浏览器脚本执行失败");
        return result.result.value;
    }

    close() {
        this.socket.close();
    }
}

async function stopBrowser(child) {
    if (child.exitCode !== null) return;
    let closed = false;
    const exited = new Promise(resolve =>
        child.once("close", () => {
            closed = true;
            resolve();
        }),
    );
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5_000))]);
    if (!closed) {
        child.kill("SIGKILL");
        await exited;
    }
}

let host;
let browser;
let devtools;
let safeToRemove = true;
try {
    const artifacts = new Map();
    const packedFiles = new Set();
    for (const [name, directory] of packageSources) {
        execFileSync("pnpm", ["pack", "--pack-destination", archives], {
            cwd: directory,
            env: process.env,
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 2 * 60_000,
        });
        const candidates = fs
            .readdirSync(archives)
            .filter(file => file.endsWith(".tgz") && !packedFiles.has(file));
        assert.equal(candidates.length, 1, `无法唯一确认 ${name} 的打包工件`);
        packedFiles.add(candidates[0]);
        artifacts.set(name, path.join(archives, candidates[0]));
    }

    fs.writeFileSync(
        path.join(runtime, "package.json"),
        JSON.stringify({ name: "onebots-installed-web-verification", private: true }),
    );
    execFileSync(
        "npm",
        [
            "install",
            "--omit=dev",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--save-exact",
            ...[...artifacts.values()].map(file => `file:${file}`),
        ],
        {
            cwd: runtime,
            env: environment,
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 10 * 60_000,
        },
    );

    const packageRoot = path.join(runtime, "node_modules/onebots");
    const bin = path.join(packageRoot, "lib/bin.js");
    const { startControlHost } = await import(
        pathToFileURL(path.join(packageRoot, "lib/control/host.js")).href
    );
    safeToRemove = false;
    host = await startControlHost({
        workspace,
        host: "127.0.0.1",
        port: 0,
        runtimeRoot: runtime,
        gatewayEntrypoint: path.join(packageRoot, "lib/gateway/entry.js"),
    });
    const address = host.server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/`;
    const installedIndex = fs.readFileSync(
        path.join(runtime, "node_modules/@onebots/web/dist/index.html"),
        "utf8",
    );
    const servedIndex = await fetch(url);
    assert.equal(servedIndex.status, 200);
    assert.equal(await servedIndex.text(), installedIndex, "管理端必须托管生产安装中的 Web 工件");

    async function cli(args) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [bin, ...args, "--data-dir", workspace], {
                cwd: runtime,
                env: environment,
                stdio: ["ignore", "pipe", "pipe"],
            });
            const stdout = [];
            const stderr = [];
            const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
            child.stdout.on("data", chunk => stdout.push(chunk));
            child.stderr.on("data", chunk => stderr.push(chunk));
            child.once("error", reject);
            child.once("close", code => {
                clearTimeout(timer);
                if (code === 0) resolve(Buffer.concat(stdout).toString("utf8").trim());
                else
                    reject(
                        new Error(
                            `CLI 退出 ${code}：${Buffer.concat(stderr).toString("utf8").trim()}`,
                        ),
                    );
            });
        });
    }
    const before = JSON.parse(await cli(["control", "status"]));
    assert.equal(before.gateway.actual, "running");
    const originalInstanceId = before.gateway.instance?.id;
    assert.ok(originalInstanceId);
    const bootstrapCode = await cli(["auth", "bootstrap"]);
    assert.match(bootstrapCode, /^[A-Za-z0-9_-]+$/);

    browser = spawn(
        findBrowser(),
        [
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--no-first-run",
            "--remote-debugging-port=0",
            `--user-data-dir=${browserProfile}`,
            "about:blank",
        ],
        { stdio: "ignore" },
    );
    const browserFailed = new Promise((_, reject) =>
        browser.once("error", error => reject(new Error(`浏览器启动失败：${error.message}`))),
    );
    const activePort = path.join(browserProfile, "DevToolsActivePort");
    const [debugPort] = (
        await Promise.race([
            waitFor(
                () => (fs.existsSync(activePort) ? fs.readFileSync(activePort, "utf8") : undefined),
                "浏览器调试端口启动",
            ),
            browserFailed,
        ])
    ).split("\n");
    const targets = await waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if (!response.ok) return undefined;
        const values = await response.json();
        return values.find(value => value.type === "page" && value.webSocketDebuggerUrl);
    }, "浏览器页面创建");
    devtools = new DevToolsSession(targets.webSocketDebuggerUrl);
    await devtools.send("Page.enable");
    await devtools.send("Runtime.enable");
    await devtools.send("Page.navigate", { url });
    await waitFor(
        () => devtools.evaluate(`document.readyState === "complete" && document.title`),
        "Web 管理端加载",
    );
    assert.match(await devtools.evaluate("document.body.innerText"), /连接管理服务/);

    await devtools.evaluate(`(() => {
        const input = document.querySelector("#pair-code");
        if (!(input instanceof HTMLInputElement)) throw new Error("找不到设备码输入框");
        input.value = ${JSON.stringify(bootstrapCode)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const form = input.closest("form");
        if (!(form instanceof HTMLFormElement)) throw new Error("找不到配对表单");
        form.requestSubmit();
    })()`);
    await waitFor(async () => {
        const text = await devtools.evaluate("document.body.innerText");
        return /管理服务\s*在线/.test(text) && /网关\s*运行中/.test(text) ? text : undefined;
    }, "Web 配对及状态读取");
    assert.equal(
        await devtools.evaluate(`localStorage.getItem("onebots.control.token") !== null`),
        true,
    );

    await devtools.evaluate(`(() => {
        const button = [...document.querySelectorAll("button")].find(value =>
            value.textContent?.includes("重启网关"),
        );
        if (!(button instanceof HTMLButtonElement) || button.disabled)
            throw new Error("网关重启按钮不可用");
        button.click();
    })()`);
    const after = await waitFor(
        async () => {
            const current = JSON.parse(await cli(["control", "status"]));
            return current.gateway.actual === "running" &&
                current.gateway.instance?.id &&
                current.gateway.instance.id !== originalInstanceId
                ? current
                : undefined;
        },
        "Web 触发的网关重启",
        60_000,
    );
    assert.equal(after.manager.id, before.manager.id);
    assert.equal(after.gateway.desired, "running");
    await waitFor(async () => {
        const text = await devtools.evaluate("document.body.innerText");
        return /重启\s*已完成/.test(text) && /网关\s*运行中/.test(text) ? text : undefined;
    }, "Web 操作结果展示");

    devtools.close();
    devtools = undefined;
    await stopBrowser(browser);
    browser = undefined;
    await host.close();
    host = undefined;
    safeToRemove = true;
    process.stdout.write(
        "✓ 已安装 npm 产物的 Web UI 在真实浏览器中完成设备码配对与网关重启；管理服务保持在线且网关实例已替换\n",
    );
} finally {
    devtools?.close();
    if (browser) {
        await stopBrowser(browser);
    }
    if (host) {
        await host.close();
        safeToRemove = true;
    }
    if (safeToRemove) fs.rmSync(temporary, { recursive: true, force: true });
    else process.stderr.write(`验收状态未确认，保留临时目录 ${temporary}\n`);
}
