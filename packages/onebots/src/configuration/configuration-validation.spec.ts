import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationValidation } from "./configuration-validation.js";
import { ConfigurationApplication } from "./configuration-application.js";
import { ConfigurationStore } from "./configuration-store.js";
import type { verifyConfiguration } from "./configuration-verify.js";

const folders: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-receipts-"));
    folders.push(directory);
    const store = new ConfigurationStore(path.join(directory, "drafts"));
    const base = { generationId: null, configRevision: "a".repeat(64) };
    let source = { revision: base.configRevision, document: { token: "old-secret" } };
    let effects = 0;
    const application = new ConfigurationApplication({
        directory: path.join(directory, "operations"),
        source: {
            read: () => structuredClone(source),
            replace: (expected, document) => {
                expect(expected).toBe(source.revision);
                effects++;
                source = { revision: "b".repeat(64), document: document as { token: string } };
                base.configRevision = source.revision;
                return structuredClone(source);
            },
        },
        lifecycle: {
            runConfigurationTransaction: async action =>
                action({
                    activeGenerationId: () => null,
                    gatewayStatus: () => ({ desired: "stopped" }),
                    hasLiveChildren: () => false,
                    suspend: async () => ({ status: "succeeded" }),
                    start: async () => {
                        throw new Error("must not start");
                    },
                }),
        },
    });
    const verify = vi.fn<typeof verifyConfiguration>(async () => ({ valid: true, issues: [] }));
    const runtime = vi.fn(async () => ({
        runtimeRoot: directory,
        selection: { adapters: [], protocols: [], applications: [] },
        fingerprint: "c".repeat(64),
    }));
    const options = {
        directory: path.join(directory, "receipts"),
        privateRoot: path.join(directory, "private"),
        store,
        application,
        currentBase: () => ({ ...base }),
        runtime,
        verify,
    };
    const validation = new ConfigurationValidation(options);
    const draft = store.create(base, { token: "synthetic-secret" });
    return {
        directory,
        options,
        validation,
        store,
        application,
        draft,
        verify,
        runtime,
        base,
        effects: () => effects,
    };
}
describe("configuration validation receipts", () => {
    it("回执写入中断不返回成功或半文件，下次可重新校验", async () => {
        const test = fixture();
        const original = fs.renameSync;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (path.dirname(String(to)) === test.options.directory)
                throw new Error("synthetic-secret");
            original(from, to);
        });
        await expect(test.validation.validate(test.draft.id, test.draft.revision)).rejects.toThrow(
            /^配置校验回执不可用，请重新校验草稿$/,
        );
        expect(fs.readdirSync(test.options.directory)).toEqual([]);
        vi.restoreAllMocks();
        expect((await test.validation.validate(test.draft.id, test.draft.revision)).valid).toBe(
            true,
        );
    });
    it("应用准备期间草稿变化必须再次拒绝，不派发旧快照", async () => {
        const test = fixture();
        const result = await test.validation.validate(test.draft.id, test.draft.revision);
        test.runtime.mockImplementation(async () => {
            test.store.replace(test.draft.id, test.draft.revision, { token: "changed" });
            return {
                runtimeRoot: test.directory,
                selection: { adapters: [], protocols: [], applications: [] },
                fingerprint: "c".repeat(64),
            };
        });
        await expect(test.validation.apply("operation", result.receiptId!)).rejects.toThrow(
            "配置已发生变化",
        );
        expect(test.effects()).toBe(0);
    });
    it("成功验证私有持久回执，无秘密；应用后重开重复同操作仅查询", async () => {
        const test = fixture();
        const result = await test.validation.validate(test.draft.id, test.draft.revision);
        expect(result).toMatchObject({
            valid: true,
            draftRevision: test.draft.revision,
            issues: [],
        });
        expect(test.verify).toHaveBeenCalledWith(
            expect.objectContaining({
                document: test.draft.document,
                privateRoot: test.options.privateRoot,
            }),
        );
        const file = path.join(test.options.directory, `${result.receiptId}.json`);
        const content = fs.readFileSync(file, "utf8");
        expect(content).not.toContain("synthetic-secret");
        if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        const applied = await test.validation.apply("operation-1", result.receiptId!);
        expect(applied.status).toBe("succeeded");
        expect(
            await new ConfigurationValidation(test.options).apply("operation-1", result.receiptId!),
        ).toEqual(applied);
        expect(test.effects()).toBe(1);
    });
    it("无效配置不发回执，错误文案不转发秘密", async () => {
        const test = fixture();
        test.verify.mockResolvedValue({
            valid: false,
            issues: [{ path: ["account", "token"], message: "synthetic-secret" }],
        });
        expect(await test.validation.validate(test.draft.id, test.draft.revision)).toEqual({
            valid: false,
            draftRevision: test.draft.revision,
            issues: [{ path: ["account", "token"], message: "配置字段无效" }],
        });
        expect(fs.readdirSync(test.options.directory)).toEqual([]);
        test.verify.mockRejectedValue(new Error("synthetic-secret"));
        await expect(test.validation.validate(test.draft.id, test.draft.revision)).rejects.toThrow(
            /^配置校验回执不可用，请重新校验草稿$/,
        );
    });
    it("校验期间草稿/base/fingerprint变化均不能获得回执", async () => {
        for (const kind of ["draft", "base", "runtime"]) {
            const test = fixture();
            test.verify.mockImplementation(async () => {
                if (kind === "draft")
                    test.store.replace(test.draft.id, test.draft.revision, { token: "changed" });
                if (kind === "base") test.base.configRevision = "d".repeat(64);
                if (kind === "runtime")
                    test.runtime.mockResolvedValue({
                        runtimeRoot: test.directory,
                        selection: { adapters: [], protocols: [], applications: [] },
                        fingerprint: "d".repeat(64),
                    });
                return { valid: true, issues: [] };
            });
            await expect(
                test.validation.validate(test.draft.id, test.draft.revision),
            ).rejects.toThrow("配置已发生变化");
            expect(fs.readdirSync(test.options.directory)).toEqual([]);
        }
    });
    it("回执应用重新核对草稿/base/runtime，失效回执不能进入应用器", async () => {
        for (const kind of ["draft", "base", "runtime"]) {
            const test = fixture();
            const receipt = await test.validation.validate(test.draft.id, test.draft.revision);
            if (kind === "draft")
                test.store.replace(test.draft.id, test.draft.revision, { token: "changed" });
            if (kind === "base") test.base.configRevision = "d".repeat(64);
            if (kind === "runtime")
                test.runtime.mockResolvedValue({
                    runtimeRoot: test.directory,
                    selection: { adapters: [], protocols: [], applications: [] },
                    fingerprint: "d".repeat(64),
                });
            await expect(test.validation.apply("operation", receipt.receiptId!)).rejects.toThrow(
                "配置已发生变化",
            );
            expect(test.effects()).toBe(0);
        }
    });
    it("已有操作记录损坏绝不当作未执行重放", async () => {
        const test = fixture();
        const result = await test.validation.validate(test.draft.id, test.draft.revision);
        fs.writeFileSync(
            path.join(test.directory, "operations", "broken.json"),
            "synthetic-secret",
            { mode: 0o600 },
        );
        const apply = vi.spyOn(test.application, "apply");
        await expect(test.validation.apply("broken", result.receiptId!)).rejects.toThrow(
            /^配置校验回执不可用，请重新校验草稿$/,
        );
        expect(apply).not.toHaveBeenCalled();
    });
    it("拒绝其他回执重用同一操作标识", async () => {
        const test = fixture();
        const a = await test.validation.validate(test.draft.id, test.draft.revision);
        const b = await test.validation.validate(test.draft.id, test.draft.revision);
        await test.validation.apply("operation", a.receiptId!);
        await expect(test.validation.apply("operation", b.receiptId!)).rejects.toThrow(
            "配置已发生变化",
        );
        expect(test.effects()).toBe(1);
    });
    it("损坏/符号链接回执与非SHA fingerprint拒绝", async () => {
        const test = fixture();
        const result = await test.validation.validate(test.draft.id, test.draft.revision);
        const file = path.join(test.options.directory, `${result.receiptId}.json`);
        fs.writeFileSync(file, "synthetic-secret");
        await expect(test.validation.apply("one", result.receiptId!)).rejects.toThrow(
            /^配置校验回执不可用，请重新校验草稿$/,
        );
        fs.unlinkSync(file);
        fs.symlinkSync(path.join(test.directory, "drafts", `${test.draft.id}.json`), file);
        await expect(test.validation.apply("two", result.receiptId!)).rejects.toThrow(
            /^配置校验回执不可用，请重新校验草稿$/,
        );
        test.runtime.mockResolvedValue({
            runtimeRoot: test.directory,
            selection: { adapters: [], protocols: [], applications: [] },
            fingerprint: "synthetic-secret",
        });
        await expect(test.validation.validate(test.draft.id, test.draft.revision)).rejects.toThrow(
            /^配置校验回执不可用，请重新校验草稿$/,
        );
    });
});
