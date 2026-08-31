import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { buildPackageManagerInvocation } from "./package-manager.js";
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
    if (snapshot.schemaVersion !== 2 || !isRecord(snapshot.packages)) {
        throw new Error("目标 OneBots 的扩展版本目录格式无效");
    }
    return packageNames.map(name => {
        if (name === "onebots") return { name, target: onebotsVersion };
        const entry = snapshot.packages[name];
        const version = isRecord(entry) ? entry.version : undefined;
        if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u.test(version)) {
            throw new Error(`目标 OneBots 的扩展版本目录缺少 ${name}`);
        }
        return { name, target: version };
    });
}

/** 从当前安装或隔离暂存的目标 OneBots 包读取版本目录。 */
export function loadTargetExtensionVersionCatalog(
    manager: "npm" | "pnpm",
    runtimeRoot: string,
    onebotsVersion: string,
    installedVersion: string | null,
    cliEntry = process.argv[1],
): ExtensionVersionCatalogSnapshot {
    const installedCatalog = findInstalledOnebotsCatalog(runtimeRoot, cliEntry);
    if (installedVersion === onebotsVersion && installedCatalog) {
        return readExtensionVersionCatalog(installedCatalog);
    }

    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-catalog-"));
    try {
        fs.writeFileSync(
            path.join(stagingRoot, "package.json"),
            '{"name":"onebots-update-catalog","private":true}\n',
            "utf8",
        );
        const invocation = buildPackageManagerInvocation(
            manager,
            manager === "pnpm"
                ? ["add", "--ignore-scripts", "--save-prod", `onebots@${onebotsVersion}`]
                : [
                      "install",
                      "--ignore-scripts",
                      "--no-save",
                      "--omit=dev",
                      `onebots@${onebotsVersion}`,
                  ],
        );
        execFileSync(invocation.executable, invocation.args, {
            cwd: stagingRoot,
            env: invocation.environment,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10 * 60 * 1000,
            maxBuffer: 4 * 1024 * 1024,
        });
        return readExtensionVersionCatalog(
            path.join(
                stagingRoot,
                "node_modules",
                "onebots",
                "lib",
                "extension-capability-catalog.json",
            ),
        );
    } catch (error) {
        const detail =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr).trim()
                : error instanceof Error
                  ? error.message
                  : String(error);
        throw new Error(`无法读取 onebots@${onebotsVersion} 的扩展版本目录：${detail}`, {
            cause: error instanceof Error ? error : undefined,
        });
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

function findInstalledOnebotsCatalog(runtimeRoot: string, cliEntry?: string): string | null {
    const candidates = [runtimeRoot];
    if (cliEntry) candidates.push(path.dirname(path.resolve(cliEntry)));
    const visited = new Set<string>();
    for (const origin of candidates) {
        let current = path.resolve(origin);
        while (!visited.has(current)) {
            visited.add(current);
            for (const candidate of [
                path.join(
                    current,
                    "node_modules",
                    "onebots",
                    "lib",
                    "extension-capability-catalog.json",
                ),
                path.join(current, "lib", "extension-capability-catalog.json"),
            ]) {
                if (fs.existsSync(candidate)) return candidate;
            }
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }
    return null;
}

function readExtensionVersionCatalog(file: string): ExtensionVersionCatalogSnapshot {
    if (!fs.existsSync(file)) throw new Error(`扩展版本目录不存在: ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as ExtensionVersionCatalogSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
