import fs from "node:fs";
import path from "node:path";
import {
    readVerifiedGeneration,
    type VerifiedGeneration,
} from "../installation/generation-store.js";
import type { ManagerCandidateVerification } from "../verification/manager-candidate.js";
const PROOF = "manager-verification.json";
interface ManagerProof {
    schemaVersion: 1;
    candidateId: string;
    verification: ManagerCandidateVerification;
}
export interface VerifiedManagerCandidate extends VerifiedGeneration {
    management: ManagerCandidateVerification;
}
/** 只读核对依赖收据和管理启动证明；不实例化安装器或改变恢复状态。 */
export function readVerifiedManagerCandidate(root: string, id: string): VerifiedManagerCandidate {
    const candidate = readVerifiedGeneration(root, id);
    const file = path.join(candidate.directory, PROOF);
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 4096 ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
    )
        throw new Error("管理程序候选启动证明无效");
    const expected: ManagerProof = {
        schemaVersion: 1,
        candidateId: candidate.id,
        verification: {
            schemaVersion: 1,
            planDigest: candidate.planDigest,
            hostVersion: candidate.receipt.hostVersion,
            coreVersion: candidate.receipt.coreVersion,
            nodeAbi: candidate.receipt.nodeAbi,
            platform: candidate.receipt.platform,
            arch: candidate.receipt.arch,
            checks: {
                managementStartup: true,
                webAssets: true,
                anonymousDenied: true,
                authenticationV2: true,
                maintenance: true,
                closed: true,
            },
        },
    };
    if (JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))) !== JSON.stringify(expected))
        throw new Error("管理程序候选启动证明与版本收据不一致");
    return { ...candidate, management: expected.verification };
}
