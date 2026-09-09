import path from "node:path";
import { closedServiceObject } from "./service-operation-storage.js";

export interface ManagerServiceRemovalFile {
    path: string;
    sha256: string;
    dev: string;
    ino: string;
    uid: number;
    mode: number;
    size: number;
    ctimeNs: string;
    mtimeNs: string;
    windowsAclDigest?: string;
}
export interface ManagerServiceRemovalSnapshot {
    definition: ManagerServiceRemovalFile;
    metadata: ManagerServiceRemovalFile;
}
export interface ManagerServiceRemoval {
    platform: "linux" | "darwin" | "win32";
    files: ManagerServiceRemovalSnapshot;
    initial: { enabled: boolean; processId: number | null; identity: string | null };
}
const fail = () => new Error("管理服务卸载快照无效");
function file(
    input: unknown,
    modes: readonly number[],
    windows: boolean,
): ManagerServiceRemovalFile {
    const value = closedServiceObject(input, [
        "path",
        "sha256",
        "dev",
        "ino",
        "uid",
        "mode",
        "size",
        "ctimeNs",
        "mtimeNs",
        ...(windows ? ["windowsAclDigest"] : []),
    ]);
    if (
        typeof value.path !== "string" ||
        !path.isAbsolute(value.path) ||
        path.normalize(value.path) !== value.path ||
        /[\u0000-\u001f\u007f]/.test(value.path) ||
        typeof value.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.sha256) ||
        typeof value.mode !== "number" ||
        !modes.includes(value.mode) ||
        !Number.isSafeInteger(value.uid) ||
        Number(value.uid) < 0 ||
        Number(value.uid) >= 0xffffffff ||
        !Number.isSafeInteger(value.size) ||
        Number(value.size) < 0 ||
        Number(value.size) > 1_048_576 ||
        (windows &&
            (typeof value.windowsAclDigest !== "string" ||
                !/^[0-9a-f]{64}$/.test(value.windowsAclDigest)))
    )
        throw fail();
    for (const key of ["dev", "ino", "ctimeNs", "mtimeNs"]) {
        if (typeof value[key] !== "string" || !/^(0|[1-9][0-9]{0,29})$/.test(value[key]))
            throw fail();
    }
    return value as unknown as ManagerServiceRemovalFile;
}
/** 只解析无业务内容的身份快照；实际路径归属由事务与 getServiceFiles 再核验。 */
export function parseManagerServiceRemovalSnapshot(input: unknown): ManagerServiceRemoval {
    const value = closedServiceObject(input, ["platform", "files", "initial"]);
    if (!["linux", "darwin", "win32"].includes(String(value.platform))) throw fail();
    const files = closedServiceObject(value.files, ["definition", "metadata"]);
    const windows = value.platform === "win32";
    const definition = file(files.definition, [0o600, 0o644], windows),
        metadata = file(files.metadata, [0o600], windows);
    if (definition.path === metadata.path) throw fail();
    const initial = closedServiceObject(value.initial, ["enabled", "processId", "identity"]);
    if (
        typeof initial.enabled !== "boolean" ||
        (initial.processId !== null &&
            (!Number.isSafeInteger(initial.processId) ||
                Number(initial.processId) < 1 ||
                Number(initial.processId) > 0x7fffffff)) ||
        (initial.identity !== null &&
            (typeof initial.identity !== "string" ||
                initial.identity.length < 1 ||
                initial.identity.length > 256 ||
                /[\u0000-\u001f\u007f]/.test(initial.identity)))
    )
        throw fail();
    return {
        platform: value.platform as ManagerServiceRemoval["platform"],
        files: { definition, metadata },
        initial: initial as unknown as ManagerServiceRemoval["initial"],
    };
}

export type RemovalFileSnapshot = ManagerServiceRemovalFile;
export type ManagerServiceRemovalFiles = Pick<
    ManagerServiceRemovalSnapshot,
    "definition" | "metadata"
>;
