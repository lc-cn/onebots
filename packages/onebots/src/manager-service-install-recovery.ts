import { managerBootstrapBindingDirectory } from "./manager-bootstrap-binding.js";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseManagerServiceRecord, type ManagerServiceRecord } from "./manager-service-journal.js";
import { parseManagerServiceSpec } from "./manager-service-spec.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { closedServiceObject } from "./service-operation-storage.js";
import { readVerifiedManagerCandidate } from "./manager-runtime/reader.js";
import { managerCandidateDigest } from "./manager-runtime/identity.js";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import {
    inspectWindowsServiceDirectorySecurity,
    inspectWindowsServiceFileSecurity,
} from "./windows-service-security.js";

const failure = () => new Error("首次安装候选或持久绑定无法确认，保留恢复门禁");
const digestPattern = /^[a-f0-9]{64}$/;

/** 调用方持服务锁；先持工件锁，再由调用方获取业务工作区锁。只读复核，不修复存储。 */
export function captureInstalledManagerCandidate(
    input: ManagerServiceRecord,
    host: ServiceHost,
): { verify(): void; dispose(): void } {
    const record = parseManagerServiceRecord(input);
    const spec = record.managerSpec;
    if (
        record.action !== "install" ||
        !["restoring-enablement", "verifying", "releasing", "completed"].includes(record.phase) ||
        !["running", "interrupted", "succeeded"].includes(record.status) ||
        !["linux", "darwin", "win32"].includes(host.platform) ||
        (host.platform === "win32"
            ? spec.scope !== "system" || host.isElevated !== true
            : spec.scope === "system" && host.uid !== 0)
    )
        throw failure();
    const files = getServiceFiles(spec.scope, host);
    const home = path.join(files.stateDir, "manager-artifacts");
    if (
        home === spec.workspace ||
        home.startsWith(spec.workspace + path.sep) ||
        spec.workspace.startsWith(home + path.sep)
    )
        throw failure();
    const bindingDirectory = managerBootstrapBindingDirectory(home, record.id);
    const directories = [
        files.stateDir,
        home,
        path.join(home, ".control"),
        path.dirname(bindingDirectory),
        bindingDirectory,
        path.join(home, "versions"),
        spec.workingDirectory,
    ];
    const identities = directories.map(directory => privateDirectory(directory, host));
    const unlock = acquireControlWorkspace(home);
    const held: ReturnType<typeof captureBinding>[] = [];
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        const closeFiles = () => {
            const file = held.pop();
            if (!file) return;
            try {
                file.close();
            } finally {
                closeFiles();
            }
        };
        try {
            closeFiles();
        } finally {
            unlock();
        }
    };
    try {
        const intentFile = captureBinding(path.join(bindingDirectory, "intent.json"), host);
        held.push(intentFile);
        const candidateFile = captureBinding(path.join(bindingDirectory, "candidate.json"), host);
        held.push(candidateFile);
        const verify = () => {
            if (disposed || managerBootstrapBindingDirectory(home, record.id) !== bindingDirectory)
                throw failure();
            directories.forEach((directory, index) => {
                const current = privateDirectory(directory, host);
                if (current.dev !== identities[index].dev || current.ino !== identities[index].ino)
                    throw failure();
            });
            const intent = closedServiceObject(intentFile.read(), [
                "schemaVersion",
                "id",
                "service",
                "planDigest",
            ]);
            const binding = closedServiceObject(candidateFile.read(), [
                "schemaVersion",
                "id",
                "planDigest",
                "candidateId",
                "candidateDigest",
                "spec",
            ]);
            if (
                intent.schemaVersion !== 1 ||
                binding.schemaVersion !== 1 ||
                intent.id !== record.id ||
                binding.id !== record.id ||
                typeof intent.planDigest !== "string" ||
                !digestPattern.test(intent.planDigest) ||
                binding.planDigest !== intent.planDigest ||
                typeof binding.candidateId !== "string" ||
                typeof binding.candidateDigest !== "string" ||
                !digestPattern.test(binding.candidateDigest)
            )
                throw failure();
            const template = parseManagerServiceSpec(intent.service);
            const boundSpec = parseManagerServiceSpec(binding.spec);
            if (
                !isDeepStrictEqual(boundSpec, spec) ||
                !isDeepStrictEqual(
                    { ...template, binPath: spec.binPath, workingDirectory: spec.workingDirectory },
                    spec,
                )
            )
                throw failure();
            const candidate = readVerifiedManagerCandidate(
                path.join(home, "versions"),
                binding.candidateId,
            );
            if (
                candidate.operationId !== record.id ||
                candidate.planDigest !== intent.planDigest ||
                candidate.directory !== path.join(home, "versions", binding.candidateId) ||
                spec.workingDirectory !== candidate.directory ||
                spec.binPath !==
                    path.join(candidate.directory, "node_modules/onebots/lib/bin.js") ||
                managerCandidateDigest(candidate) !== binding.candidateDigest
            )
                throw failure();
            const actual = verifyManagerServiceCandidate(spec, binding.candidateDigest);
            if (actual.directory !== candidate.directory || actual.id !== candidate.id)
                throw failure();
        };
        verify();
        return { verify, dispose };
    } catch (error) {
        dispose();
        throw error;
    }
}

function privateDirectory(directory: string, host: ServiceHost): fs.Stats {
    const stat = fs.lstatSync(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        fs.realpathSync(directory) !== directory ||
        (host.platform !== "win32" && (stat.mode & 0o7777) !== 0o700) ||
        (host.platform !== "win32" && process.getuid && stat.uid !== process.getuid())
    )
        throw failure();
    if (host.platform === "win32") inspectWindowsServiceDirectorySecurity(host, directory);
    return stat;
}

/** 保留原 inode 和原字节；重复核验不接受内容相同的替换文件。 */
function captureBinding(file: string, host: ServiceHost) {
    const descriptor = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
        const original = fs.fstatSync(descriptor);
        const windowsAcl =
            host.platform === "win32" ? inspectWindowsServiceFileSecurity(host, file) : undefined;
        let bytes: Buffer | undefined;
        const read = (): unknown => {
            const stat = fs.lstatSync(file);
            const anchor = fs.fstatSync(descriptor);
            if (
                !stat.isFile() ||
                stat.isSymbolicLink() ||
                stat.nlink !== 1 ||
                stat.size > 32_768 ||
                (host.platform !== "win32" && (stat.mode & 0o7777) !== 0o600) ||
                (host.platform !== "win32" && process.getuid && stat.uid !== process.getuid()) ||
                stat.dev !== original.dev ||
                stat.ino !== original.ino ||
                anchor.nlink !== 1 ||
                anchor.size !== stat.size ||
                anchor.mode !== stat.mode
            )
                throw failure();
            const buffer = Buffer.alloc(32_769);
            const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
            const after = fs.fstatSync(descriptor);
            const current = fs.lstatSync(file);
            if (
                count !== stat.size ||
                current.dev !== stat.dev ||
                current.ino !== stat.ino ||
                current.nlink !== 1 ||
                after.ctimeMs !== stat.ctimeMs ||
                after.mtimeMs !== stat.mtimeMs ||
                after.size !== stat.size ||
                current.mode !== stat.mode
            )
                throw failure();
            if (windowsAcl && inspectWindowsServiceFileSecurity(host, file) !== windowsAcl)
                throw failure();
            const result = buffer.subarray(0, count);
            if (bytes && !bytes.equals(result)) throw failure();
            bytes ??= Buffer.from(result);
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result));
        };
        read();
        return { read, close: () => fs.closeSync(descriptor) };
    } catch (error) {
        fs.closeSync(descriptor);
        throw error;
    }
}
