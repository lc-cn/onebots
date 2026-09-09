import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { closedServiceObject } from "./service-operation-storage.js";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

interface MaterializedManagerUpgradeArchive {
    file: string;
    sha256: string;
}

export class ManagerUpgradeArtifactStoreError extends Error {}

export function materializeManagerUpgradeArchive(
    input: unknown,
    directory: string,
): MaterializedManagerUpgradeArchive {
    const value = closedServiceObject(input, ["bytes", "sha256"]);
    if (
        !Buffer.isBuffer(value.bytes) ||
        value.bytes.length === 0 ||
        value.bytes.length > MAX_ARCHIVE_BYTES ||
        typeof value.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.sha256) ||
        createHash("sha256").update(value.bytes).digest("hex") !== value.sha256
    )
        throw new ManagerUpgradeArtifactStoreError("管理程序升级归档无效");
    const file = path.join(directory, `${value.sha256}.tgz`);
    if (fs.existsSync(file)) {
        verifyMaterializedArchive(file, value.sha256);
        return { file: fs.realpathSync(file), sha256: value.sha256 };
    }
    const temporary = path.join(directory, `.${value.sha256}.${randomUUID()}.tmp`);
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, value.bytes);
            fs.fchmodSync(descriptor, 0o400);
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, file);
        syncDirectory(directory);
        return { file: fs.realpathSync(file), sha256: value.sha256 };
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

export function ensurePrivateManagerUpgradeDirectory(directory: string, create = true): void {
    if (create && !fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        fs.realpathSync(directory) !== directory ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
    )
        throw new ManagerUpgradeArtifactStoreError("管理程序升级工件目录无效");
}

function verifyMaterializedArchive(file: string, sha256: string): void {
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size === 0 ||
        stat.size > MAX_ARCHIVE_BYTES ||
        (stat.mode & 0o7777) !== 0o400 ||
        (process.getuid && stat.uid !== process.getuid()) ||
        createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== sha256
    )
        throw new ManagerUpgradeArtifactStoreError("管理程序升级归档无效");
}

function syncDirectory(directory: string): void {
    const descriptor = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
}
