import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
    allocateConfigurationVerification,
    writeConfigurationVerificationOwner,
    recoverConfigurationVerifications,
} from "./configuration-verify-ownership.js";

async function deadPid(): Promise<number> {
    const process = spawn(globalThis.process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(process, "close");
    return process.pid!;
}
describe("配置验证私有目录冷恢复", () => {
    it("真实 fork 前父强杀：allocated 可回收，spawning 未知窗口保持 blocked", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-owner-crash-"));
        try {
            for (const phase of ["allocated", "spawning"] as const) {
                const source = `import fs from 'node:fs';import {allocateConfigurationVerification,writeConfigurationVerificationOwner} from ${JSON.stringify(fileURLToPath(new URL("./configuration-verify-ownership.ts", import.meta.url)))};const {directory,owner}=allocateConfigurationVerification(${JSON.stringify(root)});fs.writeFileSync(directory+'/request.json','private-value',{mode:384});owner.phase=${JSON.stringify(phase)};writeConfigurationVerificationOwner(directory,owner);console.log(owner.id);setInterval(()=>{},1000);`;
                const parent = spawn(process.execPath, ["--input-type=module", "-e", source], {
                    stdio: ["ignore", "pipe", "ignore"],
                });
                const ended = once(parent, "close");
                const id = String((await once(parent.stdout!, "data"))[0]).trim();
                parent.kill("SIGKILL");
                await ended;
                const result = recoverConfigurationVerifications(root);
                expect(result[phase === "allocated" ? "removed" : "blocked"]).toContain(id);
                if (phase === "spawning")
                    expect(await fs.readFile(path.join(root, id, "request.json"), "utf8")).toBe(
                        "private-value",
                    );
            }
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("父已死但 worker 活着不删除；全部退出后可清理，不杀旧 PID", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-owner-live-"));
        const worker = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
            detached: true,
            stdio: "ignore",
        });
        const ended = once(worker, "close");
        try {
            const { directory, owner } = allocateConfigurationVerification(root);
            owner.parentPid = await deadPid();
            owner.workerPid = worker.pid!;
            owner.phase = "running";
            writeConfigurationVerificationOwner(directory, owner);
            expect(recoverConfigurationVerifications(root).blocked).toEqual([owner.id]);
            expect(() => process.kill(worker.pid!, 0)).not.toThrow();
            worker.kill("SIGKILL");
            await ended;
            expect(recoverConfigurationVerifications(root).removed).toEqual([owner.id]);
        } finally {
            worker.kill("SIGKILL");
            await ended;
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("拒绝损坏状态、外主机、存活父进程及符号链接", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-owner-invalid-"));
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ob-owner-outside-"));
        try {
            const malformed = allocateConfigurationVerification(root);
            await fs.writeFile(path.join(malformed.directory, "owner.json"), "not-json");
            const foreign = allocateConfigurationVerification(root);
            foreign.owner.hostname = "foreign-host";
            writeConfigurationVerificationOwner(foreign.directory, foreign.owner);
            const live = allocateConfigurationVerification(root);
            const link = "11111111-1111-1111-1111-111111111111";
            await fs.symlink(outside, path.join(root, link));
            const result = recoverConfigurationVerifications(root);
            expect(result.removed).toEqual([]);
            expect(result.blocked.sort()).toEqual(
                [malformed.owner.id, foreign.owner.id, live.owner.id, link].sort(),
            );
            expect((await fs.stat(outside)).isDirectory()).toBe(true);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
            await fs.rm(outside, { recursive: true, force: true });
        }
    });
});
