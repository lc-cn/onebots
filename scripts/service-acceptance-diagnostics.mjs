import fs from "node:fs";
import path from "node:path";

const phases = new Set(["queued", "downloading", "verifying", "verified", "failed", "interrupted"]);
const errors = new Set([
    "ARTIFACT_INPUT_FAILED",
    "CANDIDATE_ALLOCATION_FAILED",
    "DOWNLOAD_FAILED",
    "VERIFICATION_FAILED",
    "INSTALL_FAILED",
    "INTERRUPTED",
]);

/** CI 只暴露候选阶段和固定错误码，不打印下载器输出、包路径或授权信息。 */
export function managerCandidateStates(stateDirectory) {
    const directory = path.join(stateDirectory, "manager-artifacts", "operations");
    try {
        return fs
            .readdirSync(directory)
            .filter(name => name.endsWith(".json"))
            .map(name => {
                try {
                    const operation = JSON.parse(
                        fs.readFileSync(path.join(directory, name), "utf8"),
                    );
                    return {
                        phase: phases.has(operation.phase) ? operation.phase : "invalid",
                        error: errors.has(operation.error) ? operation.error : null,
                    };
                } catch {
                    return { phase: "unreadable", error: null };
                }
            });
    } catch (error) {
        return [{ phase: error?.code === "ENOENT" ? "missing" : "unreadable", error: null }];
    }
}
