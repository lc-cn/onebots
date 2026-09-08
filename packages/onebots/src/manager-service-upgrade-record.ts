import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import {
    parseManagerServiceRemovalSnapshot,
    type ManagerServiceRemoval,
} from "./manager-service-removal-snapshot.js";
import { closedServiceObject } from "./service-operation-storage.js";

/** 只记录管理程序切换身份，不包含账号配置或可回写业务数据。 */
export interface ManagerServiceUpgrade {
    previousSpec: ManagerServiceSpec;
    previousCandidateDigest: string;
    candidateDigest: string;
    snapshot: ManagerServiceRemoval;
}

export function parseManagerServiceUpgrade(
    input: unknown,
    managerSpec: ManagerServiceSpec,
    desiredEnabled: boolean,
): ManagerServiceUpgrade {
    const value = closedServiceObject(input, [
        "previousSpec",
        "previousCandidateDigest",
        "candidateDigest",
        "snapshot",
    ]);
    const previousSpec = parseManagerServiceSpec(value.previousSpec);
    const target = parseManagerServiceSpec(managerSpec);
    const snapshot = parseManagerServiceRemovalSnapshot(value.snapshot);
    const fail = () => new Error("管理服务升级记录无效");
    for (const key of ["scope", "workspace", "host", "port", "nodePath"] as const) {
        if (previousSpec[key] !== target[key]) throw fail();
    }
    if (
        typeof value.previousCandidateDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.previousCandidateDigest) ||
        typeof value.candidateDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.candidateDigest) ||
        value.previousCandidateDigest === value.candidateDigest ||
        snapshot.initial.enabled !== desiredEnabled ||
        (snapshot.initial.processId === null) !== (snapshot.initial.identity === null)
    )
        throw fail();
    return {
        previousSpec,
        previousCandidateDigest: value.previousCandidateDigest,
        candidateDigest: value.candidateDigest,
        snapshot,
    };
}
