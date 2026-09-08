import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prepareDockerExtensionRuntime } from "./docker-extension-runtime.mjs";
import {
    imageFingerprint,
    validReleaseId,
    readJson,
    writeJson,
    RECEIPT,
} from "./docker-extension-release.mjs";

const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
export function makeInstallPlan(names, catalog, existing = {}) {
    const requested = { ...existing };
    for (const short of names) {
        const name = short.startsWith("@onebots/") ? short : `@onebots/adapter-${short}`;
        if (!PACKAGE_NAME.test(name) || !catalog.packages[name])
            throw new Error(`当前镜像不支持此扩展：${short}`);
        requested[name] = catalog.packages[name].version;
    }
    for (const name of Object.keys(requested)) {
        const entry = catalog.packages[name];
        if (!entry || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version))
            throw new Error(`当前镜像缺少 ${name} 的已验证版本`);
        requested[name] = entry.version;
    }
    return requested;
}
function environment(home) {
    return {
        PATH: process.env.PATH,
        HOME: home,
        USER: "node",
        LOGNAME: "node",
        COREPACK_HOME: process.env.COREPACK_HOME || "/usr/local/share/corepack",
        CI: "true",
    };
}
function execute(args, cwd, env, root = false) {
    const command = root ? "su-exec" : "pnpm";
    const parameters = root ? ["node:node", "pnpm", ...args] : args;
    const result = spawnSync(command, parameters, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 10 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
    });
    // 包管理器输出可能带凭据或下载 URL；只公布分类，不转发原始 stdout/stderr。
    if (result.error || result.status !== 0) {
        const output = `${result.stderr || ""}${result.stdout || ""}`;
        throw new Error(
            /401|403|unauthorized|forbidden/i.test(output)
                ? "私有包下载被拒绝，请检查 npmrc、read:packages 权限和包访问资格"
                : /PEER_DEP|ERESOLVE/.test(output)
                  ? "必需 peer 版本冲突，未切换运行版本"
                  : "依赖操作失败，请检查 registry、版本或离线构建要求；未切换运行版本",
        );
    }
}
export function validateRegistryConfig(contents) {
    if (contents.length > 64 * 1024) throw new Error("npmrc 文件过大");
    for (const line of contents.toString().split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || /^[#;]/.test(trimmed)) continue;
        const separator = trimmed.indexOf("=");
        if (separator < 1) throw new Error("npmrc 必须只包含 registry 和按域名限定的认证配置");
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (/^(?:@[a-z0-9._-]+:)?registry$/.test(key)) {
            let url;
            try {
                url = new URL(value);
            } catch {
                throw new Error("registry 地址无效");
            }
            if (
                url.username ||
                url.password ||
                url.search ||
                url.hash ||
                (url.protocol !== "https:" &&
                    !(
                        url.protocol === "http:" &&
                        ["127.0.0.1", "localhost"].includes(url.hostname)
                    ))
            )
                throw new Error("registry 必须使用 HTTPS，且 URL 不得包含凭据或查询参数");
        } else if (
            !/^\/\/[^\s/@]+(?:\/[^\s:]*)?\/:_(?:authToken|auth|password)$/.test(key) &&
            key !== "always-auth"
        ) {
            throw new Error(
                "npmrc 只允许 registry、按域名限定的认证项及 always-auth；不接受脚本、代理或其他执行配置",
            );
        }
    }
}

export function downloadRelease(
    directory,
    id,
    names,
    { imageRoot = "/app", secret = "/run/secrets/npmrc" } = {},
) {
    validReleaseId(id);
    if (fs.readdirSync(directory).length !== 0)
        throw new Error("候选目录必须为空，禁止覆写已安装版本");
    const catalog = readJson(
        path.join(imageRoot, "packages/onebots/lib/extension-capability-catalog.json"),
    );
    const planFile = "/run/onebots/previous-plan.json";
    const previous = fs.existsSync(planFile) ? readJson(planFile) : {};
    const packages = makeInstallPlan(names, catalog, previous);
    const prepared = prepareDockerExtensionRuntime({
        runtimeRoot: directory,
        imageRoot,
        bundledRoot: path.join(imageRoot, "development"),
    });
    const manifestPath = path.join(directory, "package.json");
    const manifest = readJson(manifestPath);
    // pnpm 会 chmod 包的 bin；镜像根目录只读，因此提供不含 CLI bin 的内核链接。
    // lib 仍指向镜像原文件，所有扩展共享同一个注册表实例。
    const hostDirectory = path.join(directory, ".image-host");
    fs.mkdirSync(hostDirectory);
    const host = readJson(path.join(imageRoot, "packages/onebots/package.json"));
    writeJson(path.join(hostDirectory, "package.json"), {
        name: host.name,
        version: host.version,
        type: "module",
        main: "lib/index.js",
    });
    fs.symlinkSync(
        path.join(imageRoot, "packages/onebots/lib"),
        path.join(hostDirectory, "lib"),
        "dir",
    );
    manifest.dependencies.onebots = `link:${hostDirectory}`;
    fs.unlinkSync(path.join(directory, "node_modules/onebots"));
    for (const [name, version] of Object.entries(packages)) {
        // 内置包由同一镜像提供；私有/额外包才从 registry 下载。
        if (!prepared.managedDependencies.includes(name)) manifest.dependencies[name] = version;
        for (const [peer, range] of Object.entries(catalog.packages[name].peerDependencies ?? {}))
            manifest.dependencies[peer] = range;
    }
    writeJson(manifestPath, manifest);
    const home = fs.mkdtempSync("/tmp/onebots-download-");
    const root = process.getuid?.() === 0;
    const auth = path.join(home, "npmrc");
    try {
        if (fs.existsSync(secret)) {
            const contents = fs.readFileSync(secret);
            validateRegistryConfig(contents);
            fs.writeFileSync(auth, contents, { mode: 0o600 });
        } else fs.writeFileSync(auth, "", { mode: 0o600 });
        if (root) {
            fs.chownSync(home, 1000, 1000);
            fs.chownSync(auth, 1000, 1000);
            fs.chownSync(manifestPath, 1000, 1000);
            fs.chownSync(directory, 1000, 1000);
            // prepare 创建的只是镜像链接及目录，不包含第三方脚本。
            const chown = spawnSync("chown", ["-hR", "node:node", directory], { encoding: "utf8" });
            if (chown.status !== 0) throw new Error("候选目录权限初始化失败");
        }
        execute(
            [
                "install",
                "--prod",
                "--ignore-scripts",
                "--config.ignore-pnpmfile=true",
                "--config.auto-install-peers=true",
                "--config.strict-peer-dependencies=true",
                "--store-dir",
                path.join(home, "store"),
            ],
            directory,
            { ...environment(home), NPM_CONFIG_USERCONFIG: auth },
            root,
        );
        writeJson(path.join(directory, RECEIPT), {
            schemaVersion: 1,
            id,
            phase: "downloaded",
            fingerprint: imageFingerprint(imageRoot),
            packages,
        });
        if (root) fs.chownSync(path.join(directory, RECEIPT), 1000, 1000);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
}
export async function verifyRelease(directory, id, allowBuild = [], imageRoot = "/app") {
    const receipt = readJson(path.join(directory, RECEIPT));
    if (
        receipt.id !== validReleaseId(id) ||
        receipt.phase !== "downloaded" ||
        receipt.fingerprint !== imageFingerprint(imageRoot)
    )
        throw new Error("下载记录与当前镜像不匹配");
    if (fs.existsSync("/run/secrets/npmrc")) throw new Error("验证容器不得挂载下载凭据");
    for (const name of allowBuild)
        if (!PACKAGE_NAME.test(name)) throw new Error("允许构建的包名无效");
    const home = fs.mkdtempSync("/tmp/onebots-verify-");
    try {
        if (allowBuild.length)
            execute(
                [
                    "rebuild",
                    "--config.ignore-pnpmfile=true",
                    "--config.ignore-scripts=false",
                    ...allowBuild,
                ],
                directory,
                environment(home),
            );
        // 与 CLI 启动顺序一致，先初始化内置框架定义，再隔离检查扩展注册。
        await import(path.join(imageRoot, "packages/onebots/lib/index.js"));
        const runtimeRequire = createRequire(path.join(directory, "package.json"));
        const { tryLoadRegisteredPlugin, pluginCandidates, inspectPlugin } = await import(
            path.join(imageRoot, "packages/onebots/lib/plugin-loader.js")
        );
        for (const [name, version] of Object.entries(receipt.packages)) {
            const type = name.startsWith("@onebots/adapter-")
                ? "adapter"
                : name.startsWith("@onebots/protocol-")
                  ? "protocol"
                  : null;
            if (!type) throw new Error("下载记录包含非扩展包");
            const short = name.slice(`@onebots/${type}-`.length);
            const found = inspectPlugin([name], runtimeRequire);
            if (found.status !== "ready" || found.version !== version)
                throw new Error(`${name} 版本或入口未通过检查`);
            const result = await tryLoadRegisteredPlugin(
                type,
                short,
                pluginCandidates(type, short),
                runtimeRequire,
            );
            if (!result.loaded) throw new Error(`${name} 加载或注册失败`);
        }
        receipt.phase = "verified";
        receipt.allowBuild = allowBuild;
        receipt.lockDigest = createHash("sha256")
            .update(fs.readFileSync(path.join(directory, "pnpm-lock.yaml")))
            .digest("hex");
        writeJson(path.join(directory, RECEIPT), receipt);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [phase, directory, id, ...names] = process.argv.slice(2);
        if (phase === "download") downloadRelease(directory, id, names);
        else if (phase === "verify") await verifyRelease(directory, id, names);
        else throw new Error("未知安装阶段");
        console.log(
            `[onebots] ${phase === "download" ? "下载完成，尚未执行依赖脚本" : "离线加载验证完成"}：${id}`,
        );
        // 验证插件可能注册长期计时器；一次性检查结束即退出。
        process.exit(0);
    } catch (error) {
        console.error(`[onebots] ${error instanceof Error ? error.message : "安装失败"}`);
        process.exit(1);
    }
}
