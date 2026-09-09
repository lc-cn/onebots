import { createHash } from "node:crypto";
import path from "node:path";
import type { ServiceSpec } from "./service-definition.js";
import { canonicalServiceJson, closedServiceObject } from "./service-operation-storage.js";
import {
    legacyWindowsSystemFiles,
    LEGACY_WINDOWS_SYSTEM_SERVICE_ID,
} from "./service-migration-windows-legacy-contract.js";

export interface LegacyWindowsScmConfiguration {
    serviceType: number;
    startType: number;
    errorControl: number;
    binaryPath: string;
    loadOrderGroup: string;
    tagId: number;
    dependencies: string[];
    account: string;
    displayName: string;
    description: string;
    sidType: number;
    delayedAutoStart: boolean;
}
export interface LegacyWindowsScmInspection {
    schemaVersion: 1;
    serviceName: typeof LEGACY_WINDOWS_SYSTEM_SERVICE_ID;
    loaded: true;
    restorationReady: false;
    state: "running" | "stopped";
    configuration: LegacyWindowsScmConfiguration;
    security: string;
    process: { pid: number; created: string; image: string } | null;
}
export interface LegacyWindowsScmArtifact {
    path: string;
    size: number;
    sha256: string;
}
export interface LegacyWindowsScmSnapshot {
    schemaVersion: 1;
    operationId: string;
    spec: ServiceSpec;
    stateDirectory: string;
    wrapperPath: string;
    inspection: LegacyWindowsScmInspection;
    files: {
        definition: LegacyWindowsScmArtifact;
        executable: LegacyWindowsScmArtifact;
        runner: LegacyWindowsScmArtifact;
    };
    digest: string;
}
const failure = () => new Error("旧 Windows SCM 恢复快照不完整或已变化，禁止迁移");
const hash = /^[a-f0-9]{64}$/;
const accounts = new Set([
    "localsystem",
    "nt authority\\localservice",
    "nt authority\\networkservice",
]);

/** 只允许无需恢复账户密码的三个内置主体；虚拟、域、gMSA 与自定义账户均不推断安全。 */
export function isRestorableLegacyWindowsAccount(account: string): boolean {
    return typeof account === "string" && accounts.has(account.toLowerCase());
}
export function parseLegacyWindowsScmInspection(input: unknown): LegacyWindowsScmInspection {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "serviceName",
        "loaded",
        "restorationReady",
        "state",
        "configuration",
        "security",
        "process",
    ]);
    if (
        value.schemaVersion !== 1 ||
        value.serviceName !== LEGACY_WINDOWS_SYSTEM_SERVICE_ID ||
        value.loaded !== true ||
        value.restorationReady !== false ||
        (value.state !== "running" && value.state !== "stopped")
    )
        throw failure();
    const config = closedServiceObject(value.configuration, [
        "serviceType",
        "startType",
        "errorControl",
        "binaryPath",
        "loadOrderGroup",
        "tagId",
        "dependencies",
        "account",
        "displayName",
        "description",
        "sidType",
        "delayedAutoStart",
    ]);
    for (const key of ["serviceType", "startType", "errorControl", "tagId", "sidType"])
        if (
            typeof config[key] !== "number" ||
            !Number.isSafeInteger(config[key]) ||
            Number(config[key]) < 0 ||
            Number(config[key]) > 0xffffffff
        )
            throw failure();
    if (
        config.serviceType !== 16 ||
        ![2, 3, 4].includes(Number(config.startType)) ||
        ![0, 1, 2, 3].includes(Number(config.errorControl)) ||
        ![0, 1, 3].includes(Number(config.sidType)) ||
        typeof config.delayedAutoStart !== "boolean" ||
        (config.delayedAutoStart && config.startType !== 2)
    )
        throw failure();
    for (const key of ["binaryPath", "loadOrderGroup", "account", "displayName", "description"])
        bounded(config[key], 32768, ["loadOrderGroup", "description"].includes(key));
    if (
        !isRestorableLegacyWindowsAccount(String(config.account)) ||
        config.displayName !== "onebots-gateway" ||
        !Array.isArray(config.dependencies) ||
        config.dependencies.length > 128 ||
        Reflect.ownKeys(config.dependencies).length !== config.dependencies.length + 1
    )
        throw failure();
    for (const item of config.dependencies) bounded(item, 256);
    bounded(value.security, 65536);
    // Native producer parses the descriptor. TS requires owner/group/DACL evidence and retains exact SDDL.
    if (!/^O:[\s\S]+G:[\s\S]+D:[\s\S]+$/.test(String(value.security))) throw failure();
    let process: LegacyWindowsScmInspection["process"] = null;
    if (value.state === "running") {
        const item = closedServiceObject(value.process, ["pid", "created", "image"]);
        if (
            typeof item.pid !== "number" ||
            !Number.isSafeInteger(item.pid) ||
            item.pid < 1 ||
            item.pid > 0xffffffff ||
            typeof item.created !== "string" ||
            !/^[1-9][0-9]{0,19}$/.test(item.created) ||
            BigInt(item.created) > 0xffffffffffffffffn
        )
            throw failure();
        windowsPath(item.image);
        process = { pid: item.pid, created: item.created, image: String(item.image) };
    } else if (value.process !== null) throw failure();
    return {
        schemaVersion: 1,
        serviceName: LEGACY_WINDOWS_SYSTEM_SERVICE_ID,
        loaded: true,
        restorationReady: false,
        state: value.state as "running" | "stopped",
        configuration: structuredClone(config) as unknown as LegacyWindowsScmConfiguration,
        security: String(value.security),
        process,
    };
}

/** 解析与摘要只证明绑定一致，不证明工件可恢复、子进程退出或允许重放外部效果。 */
export function parseLegacyWindowsScmSnapshot(input: unknown): LegacyWindowsScmSnapshot {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "operationId",
        "spec",
        "stateDirectory",
        "wrapperPath",
        "inspection",
        "files",
        "digest",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.operationId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.operationId) ||
        typeof value.digest !== "string" ||
        !hash.test(value.digest)
    )
        throw failure();
    const specValue = closedServiceObject(value.spec, [
        "scope",
        "configPath",
        "adapters",
        "protocols",
        "nodePath",
        "binPath",
        "workingDirectory",
        ...(value.spec &&
        typeof value.spec === "object" &&
        Object.hasOwn(value.spec, "applications")
            ? ["applications"]
            : []),
    ]);
    if (specValue.scope !== "system") throw failure();
    for (const key of ["configPath", "nodePath", "binPath", "workingDirectory"])
        windowsPath(specValue[key]);
    for (const key of [
        "adapters",
        "protocols",
        ...(Object.hasOwn(specValue, "applications") ? ["applications"] : []),
    ]) {
        const list = specValue[key];
        if (
            !Array.isArray(list) ||
            list.length > 256 ||
            Reflect.ownKeys(list).length !== list.length + 1
        )
            throw failure();
        for (const name of list) bounded(name, 256);
    }
    const spec = structuredClone(specValue) as unknown as ServiceSpec;
    windowsPath(value.stateDirectory);
    windowsPath(value.wrapperPath);
    const expected = legacyWindowsSystemFiles(spec, String(value.stateDirectory));
    const filesValue = closedServiceObject(value.files, ["definition", "executable", "runner"]);
    const files = {} as LegacyWindowsScmSnapshot["files"];
    for (const role of ["definition", "executable", "runner"] as const) {
        const item = closedServiceObject(filesValue[role], ["path", "size", "sha256"]);
        if (
            item.path !== expected[role] ||
            typeof item.size !== "number" ||
            !Number.isSafeInteger(item.size) ||
            item.size < 1 ||
            item.size > (role === "executable" ? 256 * 1024 * 1024 : 64 * 1024) ||
            typeof item.sha256 !== "string" ||
            !hash.test(item.sha256)
        )
            throw failure();
        files[role] = { path: String(item.path), size: item.size, sha256: item.sha256 };
    }
    const inspection = parseLegacyWindowsScmInspection(value.inspection);
    const command = /\s/.test(expected.executable)
        ? `"${expected.executable}"`
        : expected.executable;
    if (
        ![command, `"${expected.executable}"`].includes(inspection.configuration.binaryPath) ||
        (inspection.process &&
            inspection.process.image.toLowerCase() !== expected.executable.toLowerCase())
    )
        throw failure();
    const body = {
        schemaVersion: 1 as const,
        operationId: value.operationId,
        spec,
        stateDirectory: String(value.stateDirectory),
        wrapperPath: String(value.wrapperPath),
        inspection,
        files,
    };
    if (legacyWindowsScmSnapshotDigest(body) !== value.digest) throw failure();
    return { ...body, digest: value.digest };
}
export function legacyWindowsScmSnapshotDigest(
    value: Omit<LegacyWindowsScmSnapshot, "digest">,
): string {
    return createHash("sha256").update(canonicalServiceJson(value)).digest("hex");
}
function bounded(value: unknown, limit: number, empty = false): void {
    if (
        typeof value !== "string" ||
        (!empty && !value) ||
        Buffer.byteLength(value) > limit ||
        /[\u0000-\u001f\u007f]/.test(value)
    )
        throw failure();
}
function windowsPath(value: unknown): void {
    bounded(value, 4096);
    const text = String(value);
    if (
        !/^[A-Za-z]:\\/.test(text) ||
        text.slice(2).includes(":") ||
        path.win32.normalize(text) !== text ||
        text.split("\\").some(part => /[. ]$/.test(part))
    )
        throw failure();
}
