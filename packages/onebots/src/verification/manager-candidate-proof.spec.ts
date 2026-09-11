import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { verifyManagerCandidate, type ManagerCandidateVerification } from "./manager-candidate.js";

const behavior = vi.hoisted(() => ({ omitAuthentication: false }));
vi.mock("./owned-worker.js", () => ({
    runOwnedWorker: async (options: {
        request: { expected: ManagerCandidateVerification };
        decode(value: unknown): unknown;
    }) => {
        const proof = structuredClone(options.request.expected);
        if (behavior.omitAuthentication) Reflect.deleteProperty(proof.checks, "authenticationV2");
        return options.decode(proof);
    },
}));
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it.each([false, true])("父进程严格拒绝缺少认证 v2 检查的返回值：%s", async omit => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-proof-"));
    roots.push(root);
    behavior.omitAuthentication = omit;
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.0.0", spec: "1.0.0" },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        extensions: [],
        selection: { adapters: [], protocols: [], applications: [] },
    });
    const result = verifyManagerCandidate(root, plan, { privateRoot: path.join(root, "private") });
    if (omit) await expect(result).rejects.toThrow("管理程序候选验证未完成");
    else expect((await result).checks.authenticationV2).toBe(true);
});
