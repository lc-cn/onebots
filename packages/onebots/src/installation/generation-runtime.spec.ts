import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGenerationPlan } from "./generation-plan.js";
import { GenerationStore } from "./generation-store.js";
import { resolveGenerationRuntime } from "./generation-runtime.js";

const directories: string[] = [];
afterEach(() =>
    directories
        .splice(0)
        .forEach(directory => fs.rmSync(directory, { recursive: true, force: true })),
);

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-generation-runtime-"));
    directories.push(root);
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
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
        selection: { adapters: ["mock"], protocols: [], applications: ["zhin"] },
        builtinApplications: ["zhin"],
    });
    const store = new GenerationStore({ root, isActive: () => false });
    const candidate = store.allocate("runtime-test", plan.digest);
    for (const artifact of [plan.host, plan.core]) {
        const directory = path.join(candidate.directory, "node_modules", artifact.name);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({ name: artifact.name, version: artifact.version }),
        );
    }
    fs.mkdirSync(path.join(candidate.directory, "node_modules/onebots/lib/gateway"), {
        recursive: true,
    });
    fs.writeFileSync(
        path.join(candidate.directory, "node_modules/onebots/lib/gateway/entry.js"),
        "export {};",
    );
    fs.writeFileSync(path.join(candidate.directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(candidate.directory, "schemas.json"), "{}");
    fs.writeFileSync(path.join(candidate.directory, "plan.json"), JSON.stringify(plan));
    const generation = store.commitVerified(candidate.id, {
        planDigest: plan.digest,
        hostVersion: plan.host.version,
        coreVersion: plan.core.version,
        nodeAbi: plan.nodeAbi,
        platform: plan.platform,
        arch: plan.arch,
        checks: {
            packageIdentity: true,
            peerDependencies: true,
            singleHost: true,
            loadRegistration: true,
            schemas: true,
        },
    });
    return { generation, plan };
}

describe("generation runtime selection boundary", () => {
    it("does not enable installed adapters or builtin frameworks absent from user configuration", () => {
        const { generation } = fixture();
        const configured = { adapters: [], protocols: [], applications: [] };
        expect(resolveGenerationRuntime(generation, configured).selection).toEqual(configured);
        expect(
            resolveGenerationRuntime(generation, { ...configured, adapters: ["mock"] }).selection
                .adapters,
        ).toEqual(["mock"]);
    });

    it("rejects configured extensions absent from the installed generation instead of silently dropping them", () => {
        const { generation } = fixture();
        expect(() =>
            resolveGenerationRuntime(generation, {
                adapters: ["telegram"],
                protocols: [],
                applications: [],
            }),
        ).toThrow("不在当前运行版本");
    });

    it("rejects a changed declaration instead of using unverified runtime metadata", () => {
        const { generation, plan } = fixture();
        plan.manifest.dependencies.onebots = "latest";
        fs.writeFileSync(path.join(generation.directory, "plan.json"), JSON.stringify(plan));
        expect(() =>
            resolveGenerationRuntime(generation, { adapters: [], protocols: [], applications: [] }),
        ).toThrow("与验证记录不一致");
    });
});
