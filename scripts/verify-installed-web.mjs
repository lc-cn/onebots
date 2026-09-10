/**
 * Pack and production-install the published management runtime, then drive its actual Web UI
 * through a real Chromium browser. The browser performs pairing, extension installation and
 * activation, account/protocol configuration, and a real protocol request. The installed CLI only
 * observes the same manager workspace; it never performs a product mutation for this fixture.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
    ["@onebots/adapter-mock", path.join(root, "adapters/adapter-mock")],
    ["@onebots/protocol-onebot-v11", path.join(root, "protocols/onebot-v11/protocol")],
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
    if (child.exitCode !== null || child.signalCode !== null) return;
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
        const file = path.join(archives, candidates[0]);
        const manifest = JSON.parse(execFileSync("tar", ["-xOf", file, "package/package.json"]));
        assert.equal(manifest.name, name);
        artifacts.set(name, {
            name,
            version: manifest.version,
            spec: `file:${file}`,
            sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            file: candidates[0],
            manifest,
        });
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
            ...["@onebots/core", "@onebots/web", "onebots"].map(name => artifacts.get(name).spec),
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
    const resolverArtifacts = Object.fromEntries(
        ["@onebots/adapter-mock", "@onebots/protocol-onebot-v11"].map(name => {
            const { file: _file, manifest: _manifest, ...artifact } = artifacts.get(name);
            return [name, artifact];
        }),
    );
    const publicArtifact = name => {
        const { file: _file, manifest: _manifest, ...artifact } = artifacts.get(name);
        return artifact;
    };
    safeToRemove = false;
    host = await startControlHost({
        workspace,
        host: "127.0.0.1",
        port: 0,
        runtimeRoot: runtime,
        gatewayEntrypoint: path.join(packageRoot, "lib/gateway/entry.js"),
        installation: {
            resolver: {
                host: publicArtifact("onebots"),
                core: publicArtifact("@onebots/core"),
                extensionVersions: Object.fromEntries(
                    Object.entries(resolverArtifacts).map(([name, artifact]) => [
                        name,
                        artifact.version,
                    ]),
                ),
                artifacts: resolverArtifacts,
                fetchMetadata: async (name, version) => {
                    const artifact = artifacts.get(name);
                    assert.equal(artifact?.version, version);
                    return structuredClone(artifact.manifest);
                },
            },
        },
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
        const form = input.closest("form.auth-form");
        if (!(form instanceof HTMLFormElement)) throw new Error("找不到配对表单");
        input.value = ${JSON.stringify(bootstrapCode)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
    })()`);
    const gatewayIsRunning = () =>
        devtools.evaluate(`(() => {
            const pairingError = document.querySelector(".auth-form .feedback-error");
            if (pairingError instanceof HTMLElement)
                throw new Error("配对失败：" + pairingError.innerText.trim());
            const overview = document.querySelector("#overview-title");
            const manager = document.querySelector(".sidebar-status strong");
            const gateway = document.querySelector(".runtime-copy h2");
            return overview instanceof HTMLHeadingElement && overview.checkVisibility() &&
                manager?.textContent?.trim() === "管理服务在线" &&
                gateway?.textContent?.trim() === "运行中";
        })()`);
    await waitFor(gatewayIsRunning, "Web 配对及状态读取");
    assert.equal(
        await devtools.evaluate(`localStorage.getItem("onebots.control.token") !== null`),
        true,
    );

    const clickButton = text =>
        devtools.evaluate(`(() => {
            const expected = ${JSON.stringify(text)};
            const button = [...document.querySelectorAll("button")].find(value =>
                value.textContent?.trim() === expected,
            );
            if (!(button instanceof HTMLButtonElement) || button.disabled)
                throw new Error(expected + "按钮不可用");
            button.click();
            return true;
        })()`);
    const openWorkspace = async (label, headingId) => {
        await devtools.evaluate(`(() => {
            const expected = ${JSON.stringify(label)};
            const navigation = document.querySelector('nav[aria-label="控制台导航"]');
            if (!(navigation instanceof HTMLElement)) throw new Error("找不到控制台导航");
            const link = [...navigation.querySelectorAll("a")].find(value =>
                value.querySelector("strong")?.textContent?.trim() === expected,
            );
            if (!(link instanceof HTMLAnchorElement))
                throw new Error(expected + "导航不可用");
            link.click();
            return true;
        })()`);
        await waitFor(
            () =>
                devtools.evaluate(`(() => {
                    const heading = document.querySelector("#" + ${JSON.stringify(headingId)});
                    return heading instanceof HTMLHeadingElement && heading.checkVisibility();
                })()`),
            `${label}工作区显示`,
        );
    };
    const setSelect = (label, value) =>
        devtools.evaluate(`(() => {
            const select = document.querySelector(
                "select[aria-label=" + JSON.stringify(${JSON.stringify(label)}) + "]",
            );
            if (!(select instanceof HTMLSelectElement)) throw new Error("找不到选择框");
            select.value = ${JSON.stringify(value)};
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return select.value;
        })()`);
    const setInput = (label, value) =>
        devtools.evaluate(`(() => {
            const input = document.querySelector(
                "input[aria-label=" + JSON.stringify(${JSON.stringify(label)}) + "]",
            );
            if (!(input instanceof HTMLInputElement)) throw new Error("找不到输入框");
            input.value = ${JSON.stringify(value)};
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return input.value;
        })()`);

    await openWorkspace("安装与扩展", "extensions-title");
    await waitFor(
        () =>
            devtools.evaluate(`Boolean(
                document.querySelector('input[type="checkbox"][value="mock"]') &&
                document.querySelector('input[type="checkbox"][value="onebot-v11"]')
            )`),
        "Web 扩展目录加载",
    );
    await devtools.evaluate(`(() => {
        for (const name of ["mock", "onebot-v11"]) {
            const input = document.querySelector('input[type="checkbox"][value="' + name + '"]');
            if (!(input instanceof HTMLInputElement)) throw new Error("找不到扩展 " + name);
            if (!input.checked) input.click();
        }
        return true;
    })()`);
    await clickButton("查看安装计划");
    await waitFor(
        () =>
            devtools.evaluate(`Boolean([...document.querySelectorAll("button")].find(value =>
                value.textContent?.trim() === "确认并安装" && !value.disabled,
            ))`),
        "Web 安装计划确认",
    );
    await clickButton("确认并安装");
    await waitFor(
        async () => /验证通过，尚未应用/.test(await devtools.evaluate("document.body.innerText")),
        "Web 扩展安装与验证",
        10 * 60_000,
    );
    await clickButton("应用此运行版本");
    await waitFor(
        async () => /运行版本已应用/.test(await devtools.evaluate("document.body.innerText")),
        "Web 运行版本应用",
        60_000,
    );

    const installed = await waitFor(
        async () => {
            const current = JSON.parse(await cli(["control", "status"]));
            return current.gateway.actual === "running" &&
                current.gateway.instance?.id &&
                current.gateway.instance.id !== originalInstanceId &&
                current.generation.active?.id
                ? current
                : undefined;
        },
        "Web 应用运行版本后的网关切换",
        60_000,
    );
    assert.equal(installed.manager.id, before.manager.id);
    assert.equal(installed.gateway.desired, "running");

    await openWorkspace("账号与协议", "configuration-title");
    await clickButton("重新读取配置");
    await waitFor(
        () =>
            devtools.evaluate(`Boolean([...document.querySelectorAll("button")].find(value =>
                value.textContent?.trim() === "创建配置草稿" && !value.disabled,
            ))`),
        "Web 配置快照读取",
    );
    await clickButton("创建配置草稿");
    await waitFor(
        () =>
            devtools.evaluate(`Boolean(
                [...document.querySelectorAll('select[aria-label="平台适配器"] option')]
                    .find(value => value.value === "mock")
            )`),
        "Web 配置 Schema 加载",
    );
    assert.equal(await setSelect("平台适配器", "mock"), "mock");
    assert.equal(await setInput("账号标识", "installed-web"), "installed-web");
    await clickButton("添加空账号");
    await waitFor(
        async () => /mock\.installed-web/.test(await devtools.evaluate("document.body.innerText")),
        "Web 添加 Mock 账号",
    );
    assert.equal(await setSelect("协议配置位置", "mock.installed-web"), "mock.installed-web");
    assert.equal(await setSelect("输出协议", "onebot.v11"), "onebot.v11");
    await clickButton("添加配置");
    await waitFor(
        async () =>
            /mock\.installed-web \/ onebot\.v11/.test(
                await devtools.evaluate("document.body.innerText"),
            ),
        "Web 添加 OneBot v11 配置",
    );
    await clickButton("校验配置");
    await waitFor(
        async () => /校验通过，尚未应用/.test(await devtools.evaluate("document.body.innerText")),
        "Web 配置校验",
    );
    await clickButton("应用已校验配置");
    await waitFor(
        async () => /应用成功/.test(await devtools.evaluate("document.body.innerText")),
        "Web 配置应用",
        60_000,
    );
    await openWorkspace("运行概览", "overview-title");
    await waitFor(gatewayIsRunning, "Web 配置应用后的网关状态", 60_000);

    const protocolResult = await devtools.evaluate(`(async () => {
        const response = await fetch("/mock/installed-web/onebot/v11/get_login_info", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
        });
        return { status: response.status, body: await response.json() };
    })()`);
    assert.equal(protocolResult.status, 200);
    assert.equal(protocolResult.body.status, "ok");
    assert.ok(Number.isSafeInteger(protocolResult.body.data.user_id));

    devtools.close();
    devtools = undefined;
    await stopBrowser(browser);
    browser = undefined;
    await host.close();
    host = undefined;
    safeToRemove = true;
    process.stdout.write(
        "✓ 已安装 npm 产物的 Web UI 在真实浏览器中完成设备码配对、扩展安装与激活、Mock 账号和 OneBot v11 配置应用，并由浏览器取得实际协议成功响应\n",
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
