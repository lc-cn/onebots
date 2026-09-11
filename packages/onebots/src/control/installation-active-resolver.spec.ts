import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { ControlInstallationService } from "./installation-service.js";
import { GenerationStore, type VerifiedGeneration } from "../installation/generation-store.js";
import { createGenerationPlan } from "../installation/generation-plan.js";
import { activeInstallationResolver } from "./installation-active-resolver.js";
const roots: string[] = [];
const services: ControlInstallationService[] = [];
afterEach(async () => {
    for (const service of services.splice(0)) await service.close();
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ob-active-install-"));
    roots.push(directory);
    const location = path.join(directory, "active");
    fs.mkdirSync(path.join(location, "node_modules/onebots/lib"), { recursive: true });
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
        core: { name: "@onebots/core", version: "1.0.1", spec: "1.0.1" },
        selection: { adapters: [], protocols: [], applications: [] },
        extensions: [],
    });
    const catalogPath = path.join(
        location,
        "node_modules/onebots/lib/extension-capability-catalog.json",
    );
    fs.writeFileSync(path.join(location, "plan.json"), JSON.stringify(plan));
    fs.writeFileSync(
        path.join(location, "node_modules/onebots/package.json"),
        JSON.stringify({
            name: "onebots",
            version: "1.2.13",
            dependencies: { "@onebots/core": "1.0.1" },
        }),
    );
    fs.writeFileSync(
        catalogPath,
        JSON.stringify({
            schemaVersion: 2,
            packages: { "@onebots/adapter-mock": { version: "1.0.2" } },
        }),
    );
    const store = new GenerationStore({
        root: path.join(directory, "store"),
        isActive: () => false,
    });
    vi.spyOn(store, "readVerified").mockReturnValue({
        id: "active",
        directory: location,
        planDigest: plan.digest,
    } as VerifiedGeneration);
    const resolver = {
        host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        fetchMetadata: vi.fn(async (name, version) => ({ name, version })),
    };
    const service = new ControlInstallationService({
        directory,
        store,
        resolver,
        currentGenerationId: () => "active",
        currentSelection: () => plan.selection,
        lifecycle: { activate: vi.fn() },
    });
    services.push(service);
    return { directory, location, plan, catalogPath, store, resolver, service };
}
it("升级后新增扩展保留活动host/core且目录版本来自活动发布包", async () => {
    const f = fixture();
    const result = await f.service.plan(
        { adapters: ["mock"], protocols: [], applications: [] },
        "active",
    );
    expect(result.packages).toEqual([
        { name: "onebots", version: "1.2.13" },
        { name: "@onebots/core", version: "1.0.1" },
        { name: "@onebots/adapter-mock", version: "1.0.2" },
    ]);
    expect(f.resolver.fetchMetadata).toHaveBeenCalledExactlyOnceWith(
        "@onebots/adapter-mock",
        "1.0.2",
    );
    expect(f.service.catalog().adapters).toMatchObject([
        { name: "mock", displayName: expect.any(String), version: "1.0.2" },
    ]);
    expect(f.service.catalog().adapters[0].capabilitySnapshot).toBeUndefined();
    expect(f.service.catalog().adapters[0].peerDependencies).toBeUndefined();
    expect(f.service.catalog().selection).toEqual(f.plan.selection);
});
it.each(["missing", "broken", "symlink", "hardlink", "oversized", "outside-parent"])(
    "坏活动目录不回退旧宿主：%s",
    async kind => {
        const f = fixture();
        const original = fs.readFileSync(f.catalogPath);
        if (kind === "missing") fs.rmSync(f.catalogPath);
        if (kind === "broken") fs.writeFileSync(f.catalogPath, "not-json");
        if (kind === "oversized")
            fs.writeFileSync(f.catalogPath, Buffer.alloc(2 * 1024 * 1024 + 1));
        if (kind === "hardlink") fs.linkSync(f.catalogPath, path.join(f.directory, "hardlink"));
        if (kind === "symlink") {
            fs.rmSync(f.catalogPath);
            fs.writeFileSync(path.join(f.directory, "catalog"), original);
            fs.symlinkSync(path.join(f.directory, "catalog"), f.catalogPath);
        }
        if (kind === "outside-parent") {
            const source = path.dirname(f.catalogPath);
            const outside = path.join(f.directory, "outside");
            fs.renameSync(source, outside);
            fs.symlinkSync(outside, source);
        }
        expect(() => f.service.catalog()).toThrow("拒绝回退");
        await expect(
            f.service.plan({ adapters: ["mock"], protocols: [], applications: [] }, "active"),
        ).rejects.toThrow("拒绝回退");
        expect(f.resolver.fetchMetadata).not.toHaveBeenCalled();
    },
);
it("active null维持原bundled resolver身份", () => {
    const f = fixture();
    expect(activeInstallationResolver(f.store, null, f.resolver)).toBe(f.resolver);
});
it("活动manifest core必须与安装收据一致", () => {
    const f = fixture();
    fs.writeFileSync(
        path.join(f.location, "node_modules/onebots/package.json"),
        JSON.stringify({
            name: "onebots",
            version: "1.2.13",
            dependencies: { "@onebots/core": "1.0.0" },
        }),
    );
    expect(() => f.service.catalog()).toThrow("拒绝回退");
});
