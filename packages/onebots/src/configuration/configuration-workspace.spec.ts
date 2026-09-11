import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationWorkspace } from "./configuration-workspace.js";
import { ConfigurationFile } from "./configuration-file.js";
import { ConfigurationConflictError } from "./configuration-store.js";
import { normalizeConfigurationSchema } from "./configuration-schema.js";
import type { VerifiedGeneration } from "../installation/generation-store.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const schemas = {
    schemaVersion: 1,
    adapters: {},
    protocols: {},
    applications: {},
    protocolMetadata: [],
    runtimeOnly: [],
};
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-repair-context-"));
    roots.push(root);
    const filename = path.join(root, "config.yaml");
    fs.writeFileSync(filename, 'plugins: [\nprivate-token: "secret-original"', { mode: 0o600 });
    const source = new ConfigurationFile(filename);
    const inspect = vi.fn(async () => ({ schemas, fingerprint: "a".repeat(64) }));
    let active: VerifiedGeneration | null = null;
    const readSchema = vi.fn(() => normalizeConfigurationSchema({ schemas, protocols: [] }));
    const workspace = new ConfigurationWorkspace({
        source,
        runtimeRoot: root,
        hostEntrypoint: path.join(root, "trusted-host.js"),
        activeGeneration: () => active,
        readSchema,
        inspect,
    });
    return {
        workspace,
        source,
        filename,
        inspect,
        readSchema,
        setActive(value: VerifiedGeneration | null) {
            active = value;
        },
    };
}
describe("损坏配置的独立修复上下文", () => {
    it("raw revision可读，普通refresh拒绝；修复仅探测空选集且不伪造源文档", async () => {
        const value = fixture();
        const base = value.workspace.base();
        expect(base.configRevision).toBe(value.source.inspect().revision);
        await expect(value.workspace.refresh()).rejects.toThrow();
        expect(value.inspect).not.toHaveBeenCalled();
        const context = await value.workspace.refreshRepair(base);
        expect(context.base).toEqual(base);
        expect(context).not.toHaveProperty("document");
        expect(JSON.stringify(context)).not.toContain("secret-original");
        expect(value.inspect).toHaveBeenCalledWith(
            expect.objectContaining({
                selection: { adapters: [], protocols: [], applications: [] },
            }),
        );
        expect(() => value.workspace.current()).toThrow();
    });
    it("活动verified generation只读取其收据Schema，不猜损坏内容", async () => {
        const value = fixture();
        value.setActive({ id: "verified-generation" } as VerifiedGeneration);
        const base = value.workspace.base();
        await value.workspace.refreshRepair(base);
        expect(value.readSchema).toHaveBeenCalledWith("verified-generation");
        expect(value.inspect).not.toHaveBeenCalled();
    });
    it("异步探测期间raw字节或generation变化拒绝缓存", async () => {
        const value = fixture();
        const base = value.workspace.base();
        value.inspect.mockImplementationOnce(async () => {
            fs.writeFileSync(value.filename, "changed: [");
            return { schemas, fingerprint: "b".repeat(64) };
        });
        await expect(value.workspace.refreshRepair(base)).rejects.toBeInstanceOf(
            ConfigurationConflictError,
        );
        await expect(value.workspace.refreshRepair(base)).rejects.toBeInstanceOf(
            ConfigurationConflictError,
        );
        const next = value.workspace.base();
        await value.workspace.refreshRepair(next);
        value.setActive({ id: "new-generation" } as VerifiedGeneration);
        expect(() => value.workspace.currentRepair(next)).toThrow(ConfigurationConflictError);
    });
    it("源文件已修好不再允许旧repair上下文，普通模式仍需显式refresh", async () => {
        const value = fixture();
        const base = value.workspace.base();
        await value.workspace.refreshRepair(base);
        fs.writeFileSync(
            value.filename,
            "plugins:\n  adapters: []\n  protocols: []\n  applications: []\n",
        );
        expect(() => value.workspace.currentRepair(base)).toThrow(ConfigurationConflictError);
        await expect(value.workspace.refreshRepair(value.workspace.base())).rejects.toBeInstanceOf(
            ConfigurationConflictError,
        );
        const context = await value.workspace.refresh();
        expect(context.document).toHaveProperty("plugins");
    });
});
