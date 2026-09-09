import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import { managerCandidateDigest, readRunningManagerCandidate } from "./manager-runtime/identity.js";

const invalid = () => new Error("迁移来源的安装历史无法确认，禁止创建替代安装记录");

/** 调用方持服务锁；读取真实迁移及候选证据，不写入虚构的首次安装记录。 */
export function readManagerMigrationOrigin(stateDirectory: string) {
    const directory = path.join(stateDirectory, "migrations");
    try {
        fs.lstatSync(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    const journal = new FileServiceMigrationJournal(directory);
    if (journal.health().recoveryRequired) throw invalid();
    const completed = fs
        .readdirSync(directory)
        .filter(name => name.endsWith(".journal.json"))
        .map(name => journal.read(name.slice(0, -13)))
        .filter(record => record.status === "succeeded");
    if (!completed.length) return null;
    if (completed.length !== 1) throw invalid();
    const record = completed[0]!;
    const backup = journal.backup(record);
    if (!backup.retainedRuntime || !backup.targetCandidateDigest) throw invalid();
    const home = path.join(stateDirectory, "manager-artifacts");
    const bindingDirectory = path.join(home, "migrations", record.id);
    fs.lstatSync(bindingDirectory); // 缺失证据不能由存储构造器创建替代目录。
    const binding = new ServiceOperationStorage(bindingDirectory);
    const receipt = closedServiceObject(binding.read("candidate.json"), [
        "schemaVersion",
        "id",
        "planDigest",
        "candidateId",
        "digest",
        "spec",
    ]);
    const candidate = readRunningManagerCandidate(
        pathToFileURL(path.join(path.dirname(backup.target.binPath), "control/host.js")).href,
    );
    if (
        receipt.schemaVersion !== 1 ||
        receipt.id !== record.id ||
        receipt.candidateId !== candidate.id ||
        receipt.planDigest !== candidate.planDigest ||
        receipt.digest !== backup.targetCandidateDigest ||
        !isDeepStrictEqual(receipt.spec, backup.target) ||
        candidate.operationId !== `migration-${record.id}` ||
        managerCandidateDigest(candidate) !== backup.targetCandidateDigest ||
        candidate.directory !== backup.target.workingDirectory ||
        path.dirname(candidate.directory) !== path.join(home, "versions") ||
        fs.realpathSync(backup.target.binPath) !==
            fs.realpathSync(path.join(candidate.directory, "node_modules/onebots/lib/bin.js"))
    )
        throw invalid();
    return { id: `migration-${record.id}`, spec: backup.target };
}
