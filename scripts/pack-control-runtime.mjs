import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
    access,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Build-time only: pack built hosts and explicitly selected extensions, never runtime data. */
export async function packControlRuntime({
    repositoryRoot = repository,
    outputDirectory = path.join(repositoryRoot, "runtime-artifacts"),
    extensionDirectories = [],
} = {}) {
    const destination = path.resolve(outputDirectory);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
        await access(destination);
        throw new Error("运行工件输出目录已存在，请使用新的空目标路径");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    // 直接运行仓库锁定的 pnpm 入口；Windows .cmd 不能由 execFile 执行，
    // 使用 shell 又会把包路径变成命令字符串的一部分。
    const pnpmCli = path.join(
        repositoryRoot,
        "packages",
        "onebots",
        "node_modules",
        "pnpm",
        "bin",
        "pnpm.cjs",
    );
    await access(pnpmCli);
    const command = process.execPath;
    const commandPrefix = [pnpmCli];
    const environment = packageEnvironment();
    const { stdout: version } = await execute(command, [...commandPrefix, "--version"], {
        cwd: repositoryRoot,
        env: environment,
    });
    if (version.trim() !== "9.15.9") throw new Error("运行工件必须使用 pnpm 9.15.9 打包");
    const staging = await mkdtemp(path.join(path.dirname(destination), ".control-runtime-pack-"));
    try {
        const manifest = { schemaVersion: 1, extensions: [] };
        for (const [key, folder, expectedName] of [
            ["core", "core", "@onebots/core"],
            ["host", "onebots", "onebots"],
        ]) {
            const directory = path.join(repositoryRoot, "packages", folder);
            manifest[key] = await packPackage(
                directory,
                expectedName,
                staging,
                command,
                commandPrefix,
                environment,
            );
        }
        const names = new Set([manifest.host.name, manifest.core.name]);
        const trustedRoot = await realpath(repositoryRoot);
        if (!Array.isArray(extensionDirectories) || extensionDirectories.length > 64)
            throw new Error("附带扩展目录无效");
        for (const requested of extensionDirectories) {
            if (typeof requested !== "string" || !requested || path.isAbsolute(requested))
                throw new Error("附带扩展目录必须位于仓库内");
            const directory = await realpath(path.resolve(repositoryRoot, requested));
            if (!directory.startsWith(`${trustedRoot}${path.sep}`))
                throw new Error("附带扩展目录必须位于仓库内");
            const source = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
            if (
                typeof source.name !== "string" ||
                !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(source.name) ||
                names.has(source.name) ||
                !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(source.version)
            )
                throw new Error("附带扩展的包名或版本无效");
            names.add(source.name);
            manifest.extensions.push(
                await packPackage(
                    directory,
                    source.name,
                    staging,
                    command,
                    commandPrefix,
                    environment,
                ),
            );
        }
        // The manifest contains only relocatable filenames, never build machine paths or authorization.
        await writeFile(
            path.join(staging, "manifest.json"),
            JSON.stringify(manifest, null, 2) + "\n",
            { mode: 0o600 },
        );
        await rename(staging, destination);
        return manifest;
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}

async function packPackage(
    directory,
    expectedName,
    staging,
    command,
    commandPrefix,
    environment,
) {
    const source = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (
        source.name !== expectedName ||
        !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(source.version)
    )
        throw new Error("运行工件的包名或版本无效");
    await access(path.join(directory, "lib/index.js"));
    if (source.name === "onebots") await access(path.join(directory, "lib/gateway/entry.js"));
    const before = new Set(await readdir(staging));
    await execute(command, [...commandPrefix, "pack", "--pack-destination", staging], {
        cwd: directory,
        env: environment,
        maxBuffer: 4 * 1024 * 1024,
    });
    const created = (await readdir(staging)).filter(file => !before.has(file));
    if (
        created.length !== 1 ||
        !created[0].endsWith(".tgz") ||
        path.basename(created[0]) !== created[0]
    )
        throw new Error("pnpm pack 未生成唯一 tgz 工件");
    const file = created[0];
    const tarball = path.join(staging, file);
    await verifyArchive(tarball, source);
    return {
        name: source.name,
        version: source.version,
        file,
        sha256: createHash("sha256")
            .update(await readFile(tarball))
            .digest("hex"),
    };
}

async function verifyArchive(tarball, source) {
    const { stdout: listing } = await execute("tar", ["-tzf", tarball], {
        maxBuffer: 8 * 1024 * 1024,
    });
    for (const member of listing.trim().split(/\r?\n/)) {
        const segments = member.split("/");
        const filename = segments.at(-1);
        if (
            segments[0] !== "package" ||
            segments.includes("..") ||
            segments.some(segment =>
                ["node_modules", "data", "secrets", "src", "__tests__"].includes(segment),
            ) ||
            filename === ".npmrc" ||
            filename === "config.yaml" ||
            /^\.env(?:\.|$)/.test(filename) ||
            /\.(?:spec|test)\./.test(filename) ||
            (/\.tsx?$/.test(filename) && !filename.endsWith(".d.ts"))
        )
            throw new Error("运行工件包含非生产文件或私有配置");
    }
    const { stdout } = await execute("tar", ["-xOf", tarball, "package/package.json"]);
    const packed = JSON.parse(stdout);
    if (packed.name !== source.name || packed.version !== source.version)
        throw new Error("打包工件身份与源码声明不一致");
    for (const group of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ]) {
        for (const spec of Object.values(packed[group] ?? {})) {
            if (typeof spec !== "string" || /^(?:workspace|catalog|link):/.test(spec))
                throw new Error("pnpm pack 未正确翻译工作区依赖");
        }
    }
    if (
        !listing.split(/\r?\n/).includes("package/lib/index.js") ||
        (source.name === "onebots" &&
            !listing.split(/\r?\n/).includes("package/lib/gateway/entry.js"))
    )
        throw new Error("运行工件缺少已构建入口");
}

function packageEnvironment() {
    const env = {};
    for (const name of [
        "PATH",
        "HOME",
        "USERPROFILE",
        "SystemRoot",
        "WINDIR",
        "TMPDIR",
        "TMP",
        "TEMP",
        "COREPACK_HOME",
    ]) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    env.COREPACK_ENABLE_PROJECT_SPEC = "1";
    return env;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await packControlRuntime({
            outputDirectory: process.argv[2] ?? path.join(repository, "runtime-artifacts"),
            extensionDirectories: process.argv.slice(3),
        });
        process.stdout.write("[onebots] 已生成 core 和 onebots 运行工件\n");
    } catch {
        process.stderr.write("[onebots] 运行工件打包失败，请确认 pnpm 版本与构建产物\n");
        process.exitCode = 1;
    }
}
