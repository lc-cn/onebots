import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const MANIFEST_LIMIT_BYTES = 1024 * 1024;
const MANAGED_FIELD = "onebotsDockerManagedDependencies";
const BUNDLED_PREFIXES = ["@onebots/adapter-", "@onebots/protocol-"];

export function prepareDockerExtensionRuntime({
    runtimeRoot = process.env.ONEBOTS_EXTENSION_ROOT || "/data/extensions",
    bundledRoot = "/app/development",
    imageRoot = "/app",
} = {}) {
    const root = path.resolve(runtimeRoot);
    ensureDirectory(root);
    const image = fs.realpathSync(path.resolve(imageRoot));
    const bundledManifest = readManifest(path.join(bundledRoot, "package.json"));
    const bundledNames = Object.keys(asRecord(bundledManifest.dependencies) ?? {})
        .filter(isBundledExtensionDependency)
        .sort((left, right) => {
            if (left === "onebots") return -1;
            if (right === "onebots") return 1;
            return left.localeCompare(right);
        });
    if (!bundledNames.includes("onebots")) bundledNames.unshift("onebots");

    const manifestPath = path.join(root, "package.json");
    const manifest = fs.existsSync(manifestPath)
        ? readManifest(manifestPath)
        : {
              name: "onebots-docker-runtime",
              private: true,
              type: "module",
              packageManager: "pnpm@9.15.9",
          };
    const existingDependencies = asRecord(manifest.dependencies);
    if (manifest.dependencies !== undefined && !existingDependencies) {
        throw new Error(`扩展运行清单 dependencies 不是对象: ${manifestPath}`);
    }
    const dependencies = { ...(existingDependencies ?? {}) };
    const managedValue = manifest[MANAGED_FIELD];
    if (
        managedValue !== undefined &&
        (!Array.isArray(managedValue) || managedValue.some(value => typeof value !== "string"))
    ) {
        throw new Error(`扩展运行清单 ${MANAGED_FIELD} 不是字符串数组: ${manifestPath}`);
    }
    const previousManaged = managedValue ?? [];
    for (const packageName of previousManaged) delete dependencies[packageName];

    const targets = new Map();
    for (const packageName of bundledNames) {
        const source = path.join(bundledRoot, "node_modules", ...packageName.split("/"));
        const target = fs.realpathSync(source);
        assertInsideImage(target, image, packageName);
        dependencies[packageName] = `link:${target}`;
        targets.set(packageName, target);
    }

    manifest.name = "onebots-docker-runtime";
    manifest.private = true;
    manifest.type = "module";
    manifest.packageManager = "pnpm@9.15.9";
    manifest.dependencies = dependencies;
    manifest[MANAGED_FIELD] = bundledNames;
    writeManifestAtomic(manifestPath, manifest);

    const dependenciesRoot = path.join(root, "node_modules");
    ensureDirectory(dependenciesRoot);
    for (const packageName of previousManaged) {
        if (!targets.has(packageName)) {
            fs.rmSync(path.join(dependenciesRoot, ...packageName.split("/")), {
                recursive: true,
                force: true,
            });
        }
    }
    for (const [packageName, target] of targets) {
        const destination = path.join(dependenciesRoot, ...packageName.split("/"));
        ensureDirectory(path.dirname(destination));
        fs.rmSync(destination, { recursive: true, force: true });
        fs.symlinkSync(target, destination, "dir");
    }

    return { root, managedDependencies: bundledNames };
}

function isBundledExtensionDependency(packageName) {
    return (
        packageName === "onebots" || BUNDLED_PREFIXES.some(prefix => packageName.startsWith(prefix))
    );
}

function ensureDirectory(directory) {
    if (fs.existsSync(directory)) {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`扩展运行路径不是常规目录: ${directory}`);
        }
        return;
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function readManifest(manifestPath) {
    const stat = fs.lstatSync(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`扩展运行清单不是常规文件: ${manifestPath}`);
    }
    if (stat.size > MANIFEST_LIMIT_BYTES) {
        throw new Error(`扩展运行清单超过 ${MANIFEST_LIMIT_BYTES} 字节上限: ${manifestPath}`);
    }
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const manifest = asRecord(value);
    if (!manifest) throw new Error(`扩展运行清单根节点不是对象: ${manifestPath}`);
    return manifest;
}

function writeManifestAtomic(manifestPath, manifest) {
    const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
        });
        fs.renameSync(temporaryPath, manifestPath);
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

function assertInsideImage(target, imageRoot, packageName) {
    const relative = path.relative(imageRoot, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`镜像内置扩展 ${packageName} 解析到了 /app 之外: ${target}`);
    }
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    try {
        const result = prepareDockerExtensionRuntime();
        console.log(
            `[onebots] 已验证持久化扩展目录 ${result.root}（镜像内置扩展 ${result.managedDependencies.length} 个）`,
        );
    } catch (error) {
        console.error(
            `[onebots] 错误: 无法准备持久化扩展目录：${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
    }
}
