import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
    allocateDownloadCredentials,
    cleanupDownloadCredentials,
    recoverDownloadCredentials,
} from "./generation-download-state.js";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function root() {
    const directory = await mkdtemp(path.join(tmpdir(), "onebots-download-recovery-"));
    roots.push(directory);
    return directory;
}
async function exitedPid() {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(child, "close");
    return child.pid!;
}

describe("下载授权冷恢复", () => {
    it("当前worker也不能以身份授权代替未知spawn窗口的退出证据", async () => {
        const directory = await root();
        const candidate = await allocateDownloadCredentials(directory);
        candidate.owner.workerPid = process.pid;
        candidate.owner.phase = "spawning";
        await writeFile(
            path.join(candidate.directory, "owner.json"),
            JSON.stringify(candidate.owner),
        );
        await writeFile(path.join(candidate.directory, "npmrc"), "keep-until-confirmed");
        await expect(
            cleanupDownloadCredentials(candidate.directory, candidate.owner.id, true),
        ).rejects.toThrow();
        expect(await readFile(path.join(candidate.directory, "npmrc"), "utf8")).toBe(
            "keep-until-confirmed",
        );
    });
    it("仅清理本机且已确认所有进程退出的记录与授权", async () => {
        const directory = await root();
        const candidate = await allocateDownloadCredentials(directory);
        candidate.owner.parentPid = await exitedPid();
        candidate.owner.workerPid = candidate.owner.parentPid;
        candidate.owner.phase = "idle";
        await writeFile(
            path.join(candidate.directory, "owner.json"),
            JSON.stringify(candidate.owner),
        );
        await writeFile(path.join(candidate.directory, "npmrc"), "temporary-authorization", {
            mode: 0o600,
        });
        expect(await recoverDownloadCredentials(directory)).toEqual({
            removed: [candidate.owner.id],
            blocked: [],
        });
        await expect(readFile(path.join(candidate.directory, "npmrc"))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("存活或PID重用记录保守阻断，绝不删除其授权", async () => {
        const directory = await root();
        const candidate = await allocateDownloadCredentials(directory);
        await writeFile(path.join(candidate.directory, "npmrc"), "keep-me", { mode: 0o600 });
        expect(await recoverDownloadCredentials(directory)).toEqual({
            removed: [],
            blocked: [candidate.owner.id],
        });
        expect(await readFile(path.join(candidate.directory, "npmrc"), "utf8")).toBe("keep-me");
    });

    it("未知spawn窗口、异机记录、损坏记录及符号链接不能误删", async () => {
        const directory = await root();
        const pending = await allocateDownloadCredentials(directory);
        pending.owner.parentPid = await exitedPid();
        pending.owner.phase = "spawning";
        await writeFile(path.join(pending.directory, "owner.json"), JSON.stringify(pending.owner));
        const foreign = await allocateDownloadCredentials(directory);
        foreign.owner.hostname += "-other-machine";
        await writeFile(path.join(foreign.directory, "owner.json"), JSON.stringify(foreign.owner));
        const broken = await allocateDownloadCredentials(directory);
        await writeFile(path.join(broken.directory, "owner.json"), "{");
        const target = await root();
        const linkId = randomUUID();
        await writeFile(path.join(target, "keep"), "safe");
        await symlink(target, path.join(directory, linkId));
        const result = await recoverDownloadCredentials(directory);
        expect(result.removed).toEqual([]);
        expect(result.blocked.sort()).toEqual(
            [pending.owner.id, foreign.owner.id, broken.owner.id, linkId].sort(),
        );
        expect(await readFile(path.join(target, "keep"), "utf8")).toBe("safe");
    });
});
