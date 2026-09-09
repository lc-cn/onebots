import { createHash } from "node:crypto";
import type { ServiceSpec } from "./service-definition.js";
import {
    historicalWindowsSystemRunner,
    legacyWindowsSystemFiles,
    validateLegacyWindowsSystemXml,
} from "./service-migration-windows-legacy-contract.js";
import {
    legacyWindowsScmSnapshotDigest,
    parseLegacyWindowsScmInspection,
    parseLegacyWindowsScmSnapshot,
    type LegacyWindowsScmSnapshot,
} from "./service-migration-windows-scm-snapshot.js";

export interface LegacyWindowsScmCapture {
    operationId: string;
    spec: ServiceSpec;
    stateDirectory: string;
    wrapperPath: string;
    inspection: unknown;
    /** 可信只读捕获器提供原文件字节；该接口不读取任意用户路径、不持有或执行程序。 */
    files: { definition: Buffer; executable: Buffer; runner: Buffer };
}

/** 供持服务锁的捕获器写入私有迁移日志；不能单独作为停服/删除授权。 */
export function createLegacyWindowsScmSnapshot(
    input: LegacyWindowsScmCapture,
): LegacyWindowsScmSnapshot {
    const failure = () => new Error("旧 Windows 系统文件与 SCM 契约不一致，禁止捕获恢复快照");
    const paths = legacyWindowsSystemFiles(input.spec, input.stateDirectory);
    for (const role of ["definition", "executable", "runner"] as const) {
        const bytes = input.files[role];
        if (
            !Buffer.isBuffer(bytes) ||
            bytes.length < 1 ||
            bytes.length > (role === "executable" ? 256 * 1024 * 1024 : 64 * 1024)
        )
            throw failure();
    }
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(input.files.definition);
    if (
        !validateLegacyWindowsSystemXml(xml, input.spec, input.stateDirectory, input.wrapperPath) ||
        !input.files.runner.equals(Buffer.from(historicalWindowsSystemRunner(input.spec)))
    )
        throw failure();
    const files = {} as LegacyWindowsScmSnapshot["files"];
    for (const role of ["definition", "executable", "runner"] as const)
        files[role] = {
            path: paths[role],
            size: input.files[role].length,
            sha256: createHash("sha256").update(input.files[role]).digest("hex"),
        };
    const body = {
        schemaVersion: 1 as const,
        operationId: input.operationId,
        spec: input.spec,
        stateDirectory: input.stateDirectory,
        wrapperPath: input.wrapperPath,
        inspection: parseLegacyWindowsScmInspection(input.inspection),
        files,
    };
    return parseLegacyWindowsScmSnapshot({ ...body, digest: legacyWindowsScmSnapshotDigest(body) });
}

/** 重读证据与原持久摘要完全一致才通过；改变原运行意图/实例也不可默认为同一快照。 */
export function verifyLegacyWindowsScmSnapshot(
    snapshot: unknown,
    current: LegacyWindowsScmCapture,
): void {
    const original = parseLegacyWindowsScmSnapshot(snapshot);
    if (createLegacyWindowsScmSnapshot(current).digest !== original.digest)
        throw new Error("旧 Windows 恢复快照已变化，禁止继续迁移");
}
