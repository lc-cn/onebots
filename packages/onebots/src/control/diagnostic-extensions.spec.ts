import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { GenerationStore } from "../installation/generation-store.js";
import { inspectDiagnosticExtensions } from "./diagnostic-extensions.js";
const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
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
    const store = new GenerationStore({
        root: path.join(root, ".control/generations"),
        isActive: () => false,
    });
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
    fs.writeFileSync(
        path.join(candidate.directory, "schemas.json"),
        JSON.stringify({
            schemaVersion: 1,
            adapters: { mock: {} },
            protocols: {},
            applications: { zhin: { name: "zhin", displayName: "Zhin" } },
            protocolMetadata: [],
            runtimeOnly: [],
        }),
    );
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
    return { root, store, generation, plan };
}

it("bundled empty selection is ready but nonempty registration remains unchecked", () => {
    expect(inspectDiagnosticExtensions("/does-not-exist", {}, null)).toEqual({
        receipt: "bundled",
        selection: "ready",
        registration: "not-checked",
    });
    expect(
        inspectDiagnosticExtensions(
            "/does-not-exist",
            { plugins: { adapters: ["secret-module"] } },
            null,
        ),
    ).toEqual({ receipt: "bundled", selection: "unavailable", registration: "not-checked" });
    expect(inspectDiagnosticExtensions("/does-not-exist", null, null).selection).toBe(
        "unavailable",
    );
});
it("verified historical registration permits configured subsets without writes or imports", () => {
    const { root, store, generation } = fixture();
    const read = (id: string) => store.readVerified(id);
    const write = vi.spyOn(fs, "writeFileSync"),
        mkdir = vi.spyOn(fs, "mkdirSync");
    expect(
        inspectDiagnosticExtensions(root, { plugins: { adapters: ["mock"] } }, generation.id, read),
    ).toEqual({ receipt: "verified", selection: "ready", registration: "verified" });
    expect(inspectDiagnosticExtensions(root, {}, generation.id, read).selection).toBe("ready");
    expect(
        inspectDiagnosticExtensions(
            root,
            { plugins: { adapters: ["secret-module"] } },
            generation.id,
            read,
        ),
    ).toEqual({ receipt: "verified", selection: "mismatch", registration: "not-checked" });
    expect(inspectDiagnosticExtensions(root, null, generation.id, read)).toEqual({
        receipt: "verified",
        selection: "unavailable",
        registration: "not-checked",
    });
    expect(write).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
});
it("missing reader, changed receipt artifacts and broken selection fail closed without details", () => {
    const { root, store, generation } = fixture();
    expect(inspectDiagnosticExtensions(root, {}, generation.id).receipt).toBe("unavailable");
    const read = (id: string) => store.readVerified(id);
    expect(
        inspectDiagnosticExtensions(root, { plugins: { adapters: 12 } }, generation.id, read)
            .selection,
    ).toBe("unavailable");
    fs.appendFileSync(path.join(generation.directory, "schemas.json"), "synthetic-secret");
    expect(inspectDiagnosticExtensions(root, {}, generation.id, read)).toEqual({
        receipt: "invalid",
        selection: "unavailable",
        registration: "not-checked",
    });
});

it("explicit empty plugin lists cannot hide referenced accounts or standard protocols", () => {
    expect(
        inspectDiagnosticExtensions(
            "/missing",
            { plugins: { adapters: [], protocols: [] }, "mock.account": {} },
            null,
        ).selection,
    ).toBe("mismatch");
    expect(
        inspectDiagnosticExtensions(
            "/missing",
            { plugins: { adapters: [], protocols: [] }, general: { "onebot.v11": {} } },
            null,
        ).selection,
    ).toBe("mismatch");
});
