import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
    buildPackageManagerInvocation,
    formatPackageManagerDiagnostic,
    isExactPackageVersion,
    type VerifiedPackageManager,
} from "./package-manager.js";
import { inspectPackageManifest } from "./package-manifest.js";
import type { PackageUpdateEvidence } from "./update-package-transaction.js";

export interface ExtensionVersionCatalogSnapshot {
    schemaVersion?: unknown;
    packages?: unknown;
}

/** 使用目标 OneBots 随包发布的目录解析一组共同验证过的精确更新版本。 */
export function resolveVerifiedUpdateTargets(
    packageNames: readonly string[],
    onebotsVersion: string,
    snapshot: ExtensionVersionCatalogSnapshot,
): PackageUpdateEvidence[] {
    assertExactPackageVersion("onebots", onebotsVersion);
    if (snapshot.schemaVersion !== 2 || !isRecord(snapshot.packages)) {
        throw new Error("目标 OneBots 的扩展版本目录格式无效");
    }
    return packageNames.map(name => {
        if (name === "onebots") return { name, target: onebotsVersion };
        const entry = snapshot.packages[name];
        const version = isRecord(entry) ? entry.version : undefined;
        if (typeof version !== "string") {
            throw new Error(`目标 OneBots 的扩展版本目录缺少 ${name}`);
        }
        assertExactPackageVersion(name, version);
        return { name, target: version };
    });
}

/** 从当前安装或隔离暂存的目标 OneBots 包读取版本目录。 */
export function loadTargetExtensionVersionCatalog(
    packageManager: VerifiedPackageManager,
    runtimeRoot: string,
    onebotsVersion: string,
    installedVersion: string | null,
    cliEntry = process.argv[1],
): ExtensionVersionCatalogSnapshot {
    assertExactPackageVersion("onebots", onebotsVersion);
    const installedCatalog = findInstalledOnebotsCatalog(runtimeRoot, onebotsVersion, cliEntry);
    if (installedVersion === onebotsVersion && installedCatalog) {
        return installedCatalog;
    }

    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-catalog-"));
    try {
        fs.writeFileSync(
            path.join(stagingRoot, "package.json"),
            '{"name":"onebots-update-catalog","private":true}\n',
            "utf8",
        );
        const invocation = buildPackageManagerInvocation(
            packageManager.manager,
            packageManager.manager === "pnpm"
                ? ["add", "--ignore-scripts", "--save-prod", `onebots@${onebotsVersion}`]
                : [
                      "install",
                      "--ignore-scripts",
                      "--no-save",
                      "--omit=dev",
                      `onebots@${onebotsVersion}`,
                  ],
            process.platform,
            process.env,
            packageManager.resolvedPath,
        );
        execFileSync(invocation.executable, invocation.args, {
            cwd: stagingRoot,
            env: invocation.environment,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10 * 60 * 1000,
            maxBuffer: 4 * 1024 * 1024,
        });
        return readVerifiedOnebotsCatalog(
            path.join(stagingRoot, "node_modules", "onebots"),
            onebotsVersion,
        );
    } catch (error) {
        const rawDetail =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr).trim()
                : error instanceof Error
                  ? error.message
                  : String(error);
        const detail = formatPackageManagerDiagnostic(rawDetail);
        throw new Error(`无法读取 onebots@${onebotsVersion} 的扩展版本目录：${detail}`);
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

function assertExactPackageVersion(packageName: string, version: string): void {
    if (!isExactPackageVersion(version)) {
        throw new Error(`目标 OneBots 的版本目录包含非精确版本：${packageName}=${version}`);
    }
}

function findInstalledOnebotsCatalog(
    runtimeRoot: string,
    expectedVersion: string,
    cliEntry?: string,
): ExtensionVersionCatalogSnapshot | null {
    const candidates = [runtimeRoot];
    if (cliEntry) candidates.push(path.dirname(path.resolve(cliEntry)));
    const visited = new Set<string>();
    for (const origin of candidates) {
        let current = path.resolve(origin);
        while (!visited.has(current)) {
            visited.add(current);
            for (const packageRoot of [path.join(current, "node_modules", "onebots"), current]) {
                const catalog = tryReadVerifiedOnebotsCatalog(packageRoot, expectedVersion);
                if (catalog) return catalog;
            }
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }
    return null;
}

function tryReadVerifiedOnebotsCatalog(
    packageRoot: string,
    expectedVersion: string,
): ExtensionVersionCatalogSnapshot | null {
    const manifestPath = path.join(packageRoot, "package.json");
    const catalogPath = path.join(packageRoot, "lib", "extension-capability-catalog.json");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(catalogPath)) return null;
    let manifest: { name: string; version: string };
    try {
        manifest = readPackageIdentity(manifestPath);
    } catch {
        return null;
    }
    if (manifest.name !== "onebots" || manifest.version !== expectedVersion) return null;
    return readExtensionVersionCatalog(catalogPath);
}

function readVerifiedOnebotsCatalog(
    packageRoot: string,
    expectedVersion: string,
): ExtensionVersionCatalogSnapshot {
    const manifestPath = path.join(packageRoot, "package.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`暂存结果缺少 onebots@${expectedVersion} 的 package.json`);
    }
    const manifest = readPackageIdentity(manifestPath);
    if (manifest.name !== "onebots") {
        throw new Error(`暂存包身份错配：期望 onebots，实际 ${manifest.name || "未声明"}`);
    }
    if (manifest.version !== expectedVersion) {
        throw new Error(
            `暂存包版本错配：期望 onebots@${expectedVersion}，实际 ${manifest.version || "未声明"}`,
        );
    }
    return readExtensionVersionCatalog(
        path.join(packageRoot, "lib", "extension-capability-catalog.json"),
    );
}

function readPackageIdentity(file: string): { name: string; version: string } {
    const inspection = inspectPackageManifest(file);
    if ("error" in inspection) throw new Error(`包清单无法验证: ${inspection.error}`);
    const value = inspection.manifest;
    return {
        name: typeof value.name === "string" ? value.name.trim() : "",
        version: typeof value.version === "string" ? value.version.trim() : "",
    };
}

function readExtensionVersionCatalog(file: string): ExtensionVersionCatalogSnapshot {
    if (!fs.existsSync(file)) throw new Error(`扩展版本目录不存在: ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as ExtensionVersionCatalogSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
