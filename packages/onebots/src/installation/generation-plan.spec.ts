import { describe, expect, it } from "vitest";
import semver from "semver";
import {
    createGenerationPlan,
    type GenerationExtension,
    type GenerationPlanInput,
} from "./generation-plan.js";

function extension(name: string, peers: Record<string, string> = {}): GenerationExtension {
    return {
        type: "adapter",
        name,
        packageName: `@onebots/adapter-${name}`,
        version: "1.0.0",
        spec: "1.0.0",
        peerDependencies: { onebots: "^1.2.0", "@onebots/core": "^1.0.0", ...peers },
    };
}

function input(): GenerationPlanInput {
    return {
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.0.4", spec: "1.0.4" },
        selection: { adapters: ["mock"], protocols: [], applications: [] },
        extensions: [extension("mock")],
        target: { platform: "linux", arch: "x64", nodeAbi: "137" },
    };
}

describe("generation declaration plan", () => {
    it("keeps exact host/core sources and all required peers in one manifest", () => {
        const source = input();
        source.host.spec = "file:/tmp/onebots-1.2.12.tgz";
        source.host.sha256 = "a".repeat(64);
        source.extensions[0].peerDependencies["@icqqjs/icqq"] = "^1.2.3";
        const plan = createGenerationPlan(source);
        expect(plan.manifest.packageManager).toBe("pnpm@9.15.9");
        expect(plan.manifest.dependencies).toMatchObject({
            onebots: source.host.spec,
            "@onebots/core": "1.0.4",
            "@onebots/adapter-mock": "1.0.0",
        });
        expect(semver.satisfies("1.3.0", plan.dependencies["@icqqjs/icqq"])).toBe(true);
        expect(plan.manifest.pnpm.overrides).toEqual({
            onebots: source.host.spec,
            "@onebots/core": "1.0.4",
        });
        expect(plan.peerRequirements).toContainEqual({
            requestedBy: "@onebots/adapter-mock",
            packageName: "onebots",
            range: "^1.2.0",
        });
        expect(plan.host.sha256).toBe("a".repeat(64));
    });

    it("produces an identical digest regardless of catalog and selection order", () => {
        const source = input();
        source.selection.adapters = ["telegram", "mock"];
        source.extensions.push(extension("telegram", { zod: "^3.0.0" }));
        const first = createGenerationPlan(source);
        source.selection.adapters.reverse();
        source.extensions.reverse();
        source.extensions[0].peerDependencies = Object.fromEntries(
            Object.entries(source.extensions[0].peerDependencies).reverse(),
        );
        expect(createGenerationPlan(source)).toEqual(first);
        expect(Object.keys(first.dependencies)).toEqual(Object.keys(first.dependencies).sort());
        source.target!.nodeAbi = "138";
        expect(createGenerationPlan(source).digest).not.toBe(first.digest);
    });

    it.each([
        "latest",
        "^1.2.12",
        "workspace:*",
        "link:/tmp/runtime",
        "https://secret@example.com/pkg.tgz",
    ])("rejects mutable or unauthorized artifact spec %s", spec => {
        const source = input();
        source.host.spec = spec;
        expect(() => createGenerationPlan(source)).toThrow();
    });

    it.each(["file:relative.tgz", "file:/tmp/runtime", "file:/tmp/runtime.tgz?token=secret"])(
        "requires absolute tarball paths and hashes: %s",
        spec => {
            const source = input();
            source.host.spec = spec;
            source.host.sha256 = "a".repeat(64);
            expect(() => createGenerationPlan(source)).toThrow("绝对 .tgz");
        },
    );

    it("requires a digest for local artifacts without reading or downloading them", () => {
        const source = input();
        source.host.spec = "file:/not-present/host.tgz";
        expect(() => createGenerationPlan(source)).toThrow("sha256");
        source.host.sha256 = "a".repeat(64);
        expect(createGenerationPlan(source).host.spec).toBe(source.host.spec);
    });

    it("accepts exact semver build metadata without accepting a leading version prefix", () => {
        const source = input();
        source.host.version = source.host.spec = "1.2.12+custom.1";
        expect(createGenerationPlan(source).host.version).toBe("1.2.12+custom.1");
        source.host.version = source.host.spec = "v1.2.12";
        expect(() => createGenerationPlan(source)).toThrow("精确 semver");
    });

    it.each(["onebots", "@onebots/core"])(
        "rejects incompatible original %s peer despite overrides",
        packageName => {
            const source = input();
            source.extensions[0].peerDependencies[packageName] = "^2.0.0";
            expect(() => createGenerationPlan(source)).toThrow("不满足扩展原始 peer");
        },
    );

    it("preserves OR intersections and every original peer edge", () => {
        const source = input();
        source.selection.adapters.push("other");
        source.extensions[0].peerDependencies.shared = "^1.0.0 || ^3.0.0";
        source.extensions.push(extension("other", { shared: "^2.0.0 || >=3.2.0 <4.0.0" }));
        const plan = createGenerationPlan(source);
        expect(semver.satisfies("1.5.0", plan.dependencies.shared)).toBe(false);
        expect(semver.satisfies("2.5.0", plan.dependencies.shared)).toBe(false);
        expect(semver.satisfies("3.1.0", plan.dependencies.shared)).toBe(false);
        expect(semver.satisfies("3.2.0", plan.dependencies.shared)).toBe(true);
        expect(plan.peerRequirements.filter(peer => peer.packageName === "shared")).toHaveLength(2);
        source.extensions[1].peerDependencies.shared = "^2.0.0";
        expect(() => createGenerationPlan(source)).toThrow("约束冲突");
    });

    it("accepts stable versions within an intersection whose minimum is a prerelease", () => {
        const source = input();
        source.selection.adapters.push("other");
        source.extensions[0].peerDependencies.shared = ">=1.0.0-0";
        source.extensions.push(extension("other", { shared: "*" }));
        const range = createGenerationPlan(source).dependencies.shared;
        expect(semver.satisfies("1.0.0", range)).toBe(true);
        expect(semver.satisfies("1.0.0-beta", range)).toBe(false);
    });

    it.each([
        ["*", ">=1.0.0-0"],
        ["^1.0.0-0", "<1.1.0"],
        [">=1.0.0-beta <2.0.0", "<=1.0.0-rc"],
        [">=1.0.0-0 <2.0.0-0", ">=1.0.0 <2.0.0"],
        ["^1.0.0 || ^3.0.0", "^2.0.0 || >=3.2.0 <4.0.0"],
    ])("retains original semver membership across %s AND %s", (left, right) => {
        const source = input();
        source.selection.adapters.push("other");
        source.extensions[0].peerDependencies.shared = left;
        source.extensions.push(extension("other", { shared: right }));
        const range = createGenerationPlan(source).dependencies.shared;
        for (const version of [
            "0.9.0",
            "1.0.0-0",
            "1.0.0-alpha",
            "1.0.0-beta",
            "1.0.0-rc",
            "1.0.0",
            "1.0.1",
            "1.1.0-beta",
            "1.1.0",
            "2.0.0-0",
            "2.0.0",
            "3.1.0",
            "3.2.0",
            "4.0.0",
        ]) {
            expect(semver.satisfies(version, range), `${version} in ${range}`).toBe(
                semver.satisfies(version, left) && semver.satisfies(version, right),
            );
        }
    });

    it("rejects omitted, extra, or duplicate extension identities", () => {
        const source = input();
        source.extensions = [];
        expect(() => createGenerationPlan(source)).toThrow("缺少");
        source.extensions = [extension("other")];
        expect(() => createGenerationPlan(source)).toThrow("不一致");
        source.extensions = [extension("mock"), extension("mock")];
        expect(() => createGenerationPlan(source)).toThrow("重复");
    });

    it("keeps builtin framework selection without adding a package or protocol", () => {
        const source = input();
        source.selection.applications = ["zhin"];
        source.builtinApplications = ["zhin"];
        const plan = createGenerationPlan(source);
        expect(plan.selection.applications).toEqual(["zhin"]);
        expect(plan.selection.protocols).toEqual([]);
        expect(Object.keys(plan.dependencies)).not.toContain("@onebots/application-zhin");
        source.builtinApplications = [];
        expect(() => createGenerationPlan(source)).toThrow("缺少");
    });

    it("does not copy authorization or arbitrary fields into the output", () => {
        const source = { ...input(), token: "private-test-secret", npmrc: "private-test-secret" };
        Object.assign(source.host, { authorization: "private-test-secret" });
        Object.assign(source.extensions[0], { token: "private-test-secret" });
        expect(JSON.stringify(createGenerationPlan(source))).not.toContain("private-test-secret");
    });
});
