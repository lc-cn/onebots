import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { verifyManagerCandidate } from "./manager-candidate.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const plan = () =>
    createGenerationPlan({
        host: { name: "onebots", version: "1.0.0", spec: "1.0.0" },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
it.each(["digest", "abi", "extension", "cancelled", "timeout"])(
    "拒绝%s时不创建验证目录或启动候选",
    async kind => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-guard-"));
        roots.push(root);
        const privateRoot = path.join(root, "private");
        let candidate = plan();
        if (kind === "digest") candidate.digest = "0".repeat(64);
        if (kind === "abi")
            candidate = createGenerationPlan({
                ...candidate,
                target: {
                    platform: process.platform,
                    arch: process.arch,
                    nodeAbi: "1",
                },
            });
        if (kind === "extension")
            candidate = createGenerationPlan({
                ...candidate,
                selection: { adapters: ["mock"], protocols: [], applications: [] },
                extensions: [
                    {
                        type: "adapter",
                        name: "mock",
                        packageName: "@onebots/adapter-mock",
                        version: "1.0.0",
                        spec: "1.0.0",
                        peerDependencies: {},
                    },
                ],
            });
        await expect(
            verifyManagerCandidate(root, candidate, {
                privateRoot,
                timeoutMs: kind === "timeout" ? 0 : 1000,
                signal: kind === "cancelled" ? AbortSignal.abort() : undefined,
            }),
        ).rejects.toThrow("管理程序候选计划或验证环境无效");
        expect(fs.readdirSync(root)).toEqual([]);
    },
);
