import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import { readRunningManagerCandidate, managerCandidateDigest } from "./manager-runtime/identity.js";
import type { VerifiedManagerCandidate } from "./manager-runtime/reader.js";

/** 只读核验系统服务实际入口与候选双证明；调用方负责持有服务和候选存储锁。 */
export function verifyManagerServiceCandidate(
    input: ManagerServiceSpec,
    digest: string,
): VerifiedManagerCandidate {
    const spec = parseManagerServiceSpec(input);
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))
        throw new Error("管理升级候选摘要无效");
    const candidate = readRunningManagerCandidate(pathToFileURL(
        path.join(path.dirname(spec.binPath), "control/host.js"),
    ).href);
    const binPath = fs.realpathSync(spec.binPath);
    if (managerCandidateDigest(candidate) !== digest ||
        candidate.management.checks.authenticationV2 !== true ||
        fs.realpathSync(spec.workingDirectory) !== candidate.directory ||
        !binPath.startsWith(candidate.directory + path.sep) ||
        !fs.statSync(binPath).isFile() ||
        binPath !== fs.realpathSync(path.join(candidate.directory, "node_modules/onebots/lib/bin.js")) ||
        fs.realpathSync(spec.nodePath) !== fs.realpathSync(process.execPath))
        throw new Error("管理升级服务入口与已验证候选不一致");
    return candidate;
}
