import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MANIFEST_LIMIT_BYTES = 1024 * 1024;
const MANAGED_FIELD = "onebotsDockerManagedDependencies";
const BUNDLED_PREFIXES = ["@onebots/adapter-", "@onebots/protocol-"];

export function prepareDockerExtensionRuntime({
    runtimeRoot = process.env.ONEBOTS_EXTENSION_ROOT || "/data/extensions",
    bundledRoot = "/app/development",
    imageRoot = "/app",
    recoveryPath = path.join(runtimeRoot, "hf-restore.json"),
    packageCatalog,
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

    const recovery = fs.existsSync(recoveryPath)
        ? readExtensionRecovery(
              recoveryPath,
              packageCatalog ??
                  readPackageCatalog("/app/packages/onebots/lib/extension-capability-catalog.json"),
          )
        : { packages: {} };
    for (const [packageName, version] of Object.entries(recovery.packages)) {
        dependencies[packageName] = version;
    }

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

    const missingRecoveryPackages = Object.entries(recovery.packages)
        .filter(([packageName, version]) => !installedVersionMatches(root, packageName, version))
        .map(([packageName]) => packageName);
    return {
        root,
        managedDependencies: bundledNames,
        recoveryPath,
        recoveryPackages: Object.keys(recovery.packages),
        recoveryVersions: recovery.packages,
        missingRecoveryPackages,
    };
}

export function restoreDockerExtensionRuntime(options = {}, dependencies = { spawn: spawnSync }) {
    const prepared = prepareDockerExtensionRuntime(options);
    if (!fs.existsSync(prepared.recoveryPath)) return prepared;
    if (prepared.missingRecoveryPackages.length > 0) {
        const allowed = new Set([...prepared.managedDependencies, ...prepared.recoveryPackages]);
        const manifest = readManifest(path.join(prepared.root, "package.json"));
        const manifestDependencies = asRecord(manifest.dependencies) ?? {};
        const unexpected = Object.keys(manifestDependencies).filter(
            packageName => !allowed.has(packageName),
        );
        if (unexpected.length > 0) {
            throw new Error(
                `HF 自动恢复拒绝安装恢复清单之外的依赖: ${unexpected.sort().join(", ")}`,
            );
        }
        const result = dependencies.spawn("pnpm", ["install", "--prod", "--no-frozen-lockfile"], {
            cwd: prepared.root,
            env: process.env,
            stdio: "inherit",
            timeout: 10 * 60 * 1000,
        });
        if (result.error || result.status !== 0) {
            throw new Error(
                `HF 扩展依赖恢复失败（pnpm exit ${String(result.status)}）${result.error ? `: ${result.error.message}` : ""}`,
            );
        }
        const unresolved = Object.entries(prepared.recoveryVersions)
            .filter(
                ([packageName, version]) =>
                    !installedVersionMatches(prepared.root, packageName, version),
            )
            .map(([packageName]) => packageName);
        if (unresolved.length > 0) {
            throw new Error(`HF 扩展依赖恢复后版本仍不匹配: ${unresolved.join(", ")}`);
        }
    }
    fs.rmSync(prepared.recoveryPath, { force: true });
    return { ...prepared, missingRecoveryPackages: [] };
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

function readPackageCatalog(catalogPath) {
    const catalog = readBoundedJson(catalogPath, "扩展版本目录");
    const packages = asRecord(catalog.packages);
    if (catalog.schemaVersion !== 2 || !packages) {
        throw new Error(`扩展版本目录格式无效: ${catalogPath}`);
    }
    const result = {};
    for (const [packageName, value] of Object.entries(packages)) {
        const entry = asRecord(value);
        if (!entry || typeof entry.version !== "string" || !isExactVersion(entry.version)) {
            throw new Error(`扩展版本目录 ${packageName} 缺少精确版本`);
        }
        result[packageName] = entry.version;
    }
    return result;
}

function readExtensionRecovery(recoveryPath, packageCatalog) {
    const recovery = readBoundedJson(recoveryPath, "HF 扩展恢复清单");
    const packages = asRecord(recovery.packages);
    if (recovery.schemaVersion !== 1 || !packages) {
        throw new Error(`HF 扩展恢复清单格式无效: ${recoveryPath}`);
    }
    const resolved = {};
    for (const [packageName, backupVersion] of Object.entries(packages)) {
        if (typeof backupVersion !== "string" || !isExactVersion(backupVersion)) {
            throw new Error(`HF 扩展恢复清单 ${packageName} 缺少精确版本`);
        }
        const targetVersion = packageCatalog[packageName];
        if (!targetVersion) {
            throw new Error(`HF 扩展恢复清单包含当前镜像不信任的包: ${packageName}`);
        }
        resolved[packageName] = targetVersion;
    }
    return { packages: resolved };
}

function readBoundedJson(filePath, label) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label}不是常规文件: ${filePath}`);
    }
    if (stat.size > MANIFEST_LIMIT_BYTES) {
        throw new Error(`${label}超过 ${MANIFEST_LIMIT_BYTES} 字节上限: ${filePath}`);
    }
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const record = asRecord(value);
    if (!record) throw new Error(`${label}根节点不是对象: ${filePath}`);
    return record;
}

function installedVersionMatches(root, packageName, expectedVersion) {
    const manifestPath = path.join(root, "node_modules", ...packageName.split("/"), "package.json");
    if (!fs.existsSync(manifestPath)) return false;
    try {
        const manifest = readManifest(manifestPath);
        return manifest.name === packageName && manifest.version === expectedVersion;
    } catch {
        return false;
    }
}

function isExactVersion(value) {
    return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(value);
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
        const restoring = process.argv.slice(2).includes("--restore");
        const result = restoring
            ? restoreDockerExtensionRuntime()
            : prepareDockerExtensionRuntime();
        console.log(
            `[onebots] 已验证持久化扩展目录 ${result.root}（镜像内置扩展 ${result.managedDependencies.length} 个${restoring ? `，HF 恢复扩展 ${result.recoveryPackages.length} 个` : ""}）`,
        );
    } catch (error) {
        console.error(
            `[onebots] 错误: 无法准备持久化扩展目录：${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
    }
}
