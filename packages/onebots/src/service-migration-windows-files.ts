import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { getServiceFiles, writePrivateJson } from "./service-files.js";
import { closedServiceObject } from "./service-operation-storage.js";
import type { LegacyWindowsScmArtifact } from "./service-migration-windows-scm-snapshot.js";
import type { ServiceHost } from "./service-host.js";
import {
    inspectWindowsServiceFileSecurity,
    secureWindowsServiceFile,
} from "./windows-service-security.js";

interface SourceReceipt {
    schemaVersion: 1;
    path: string;
    mode: number;
    sha256: string;
    contentBase64: string;
}
const failure = () => new Error("Windows 旧服务迁移文件已变化，已保留恢复记录");

export function stableWindowsMigrationFile(
    file: string,
    limit: number,
): { bytes: Buffer; mode: number } {
    const before = fs.lstatSync(file);
    const bytes = new ConfigurationFile(file).readRaw().bytes;
    const after = fs.lstatSync(file);
    if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1 ||
        bytes.length > limit ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
    )
        throw failure();
    return { bytes, mode: after.mode & 0o777 };
}

export function captureWindowsMigrationSource(operationDirectory: string, host: ServiceHost): void {
    const metadataPath = getServiceFiles("system", host).metadata;
    const metadata = stableWindowsMigrationFile(metadataPath, 1024 * 1024);
    const source: SourceReceipt = {
        schemaVersion: 1,
        path: metadataPath,
        mode: metadata.mode,
        sha256: digest(metadata.bytes),
        contentBase64: metadata.bytes.toString("base64"),
    };
    const file = path.join(operationDirectory, "source.json");
    writePrivateJson(file, source);
    secureWindowsServiceFile(host, file);
}

export function removeWindowsMigrationSource(
    stateDirectory: string,
    id: string,
    host: ServiceHost,
): void {
    const source = sourceReceipt(stateDirectory, id, host);
    if (digest(stableWindowsMigrationFile(source.path, 1024 * 1024).bytes) !== source.sha256)
        throw failure();
    fs.unlinkSync(source.path);
}

export function restoreWindowsMigrationSource(
    stateDirectory: string,
    id: string,
    host: ServiceHost,
): void {
    const source = sourceReceipt(stateDirectory, id, host);
    if (fs.existsSync(source.path)) {
        if (digest(stableWindowsMigrationFile(source.path, 1024 * 1024).bytes) !== source.sha256)
            throw failure();
        return;
    }
    const temporary = path.join(path.dirname(source.path), `.onebots-restore-${randomUUID()}`);
    try {
        fs.writeFileSync(temporary, Buffer.from(source.contentBase64, "base64"), {
            flag: "wx",
            mode: source.mode,
        });
        secureWindowsServiceFile(host, temporary);
        fs.linkSync(temporary, source.path);
        inspectWindowsServiceFileSecurity(host, source.path);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

export function removeExactWindowsLegacyArtifact(artifact: LegacyWindowsScmArtifact): void {
    if (!fs.existsSync(artifact.path)) return;
    const current = stableWindowsMigrationFile(artifact.path, 256 * 1024 * 1024);
    if (current.bytes.length !== artifact.size || digest(current.bytes) !== artifact.sha256)
        throw failure();
    fs.unlinkSync(artifact.path);
}

function sourceReceipt(stateDirectory: string, id: string, host: ServiceHost): SourceReceipt {
    const file = path.join(stateDirectory, "windows-migration", "operations", id, "source.json");
    inspectWindowsServiceFileSecurity(host, file);
    const stable = stableWindowsMigrationFile(file, 2 * 1024 * 1024);
    const value = closedServiceObject(JSON.parse(stable.bytes.toString("utf8")), [
        "schemaVersion",
        "path",
        "mode",
        "sha256",
        "contentBase64",
    ]);
    if (
        typeof value.contentBase64 !== "string" ||
        value.contentBase64.length > Math.ceil((1024 * 1024) / 3) * 4
    )
        throw failure();
    const bytes = Buffer.from(value.contentBase64, "base64");
    if (
        value.schemaVersion !== 1 ||
        value.path !== getServiceFiles("system", host).metadata ||
        typeof value.mode !== "number" ||
        !Number.isInteger(value.mode) ||
        value.mode < 0 ||
        value.mode > 0o777 ||
        typeof value.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.sha256) ||
        digest(bytes) !== value.sha256 ||
        bytes.toString("base64") !== value.contentBase64
    )
        throw failure();
    return structuredClone(value) as unknown as SourceReceipt;
}

function digest(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}
