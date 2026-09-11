import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationApplication } from "./configuration-application.js";
import { ConfigurationFile } from "./configuration-file.js";
import { ConfigurationRecoveryStore } from "./configuration-recovery-store.js";
import type {
    ConfigurationTransactionPort,
    ConfigurationRecoveryTransactionPort,
} from "../control/generation-activation.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(desired: "running" | "stopped" = "running") {
    const root = fs.mkdtempSync("/tmp/ob-repair-apply-");
    roots.push(root);
    const file = path.join(root, "config.yaml");
    const original = Buffer.from('token: "原始秘密\r\ninvalid: [\r\n');
    fs.writeFileSync(file, original);
    const source = new ConfigurationFile(file);
    const recovery = new ConfigurationRecoveryStore(path.join(root, "backups"));
    const repair = recovery.backup(source.readRaw());
    const calls: string[] = [];
    const state = { live: desired === "running", failStart: false, drift: false };
    const port: ConfigurationTransactionPort = {
        activeGenerationId: () => null,
        gatewayStatus: () => ({ desired, recoveryRequired: false }),
        hasLiveChildren: () => state.live,
        suspend: async () => {
            calls.push("stop");
            state.live = false;
            return { status: "succeeded" };
        },
        start: async () => {
            calls.push("start");
            if (state.drift) fs.writeFileSync(file, "external: preserved\n");
            state.live = !state.failStart;
            return { status: state.failStart ? "failed" : "succeeded" };
        },
    };
    const options = {
        directory: path.join(root, "operations"),
        source,
        recovery,
        lifecycle: {
            runConfigurationTransaction: <T>(
                task: (port: ConfigurationTransactionPort) => Promise<T>,
            ) => task(port),
            runConfigurationRecoveryTransaction: <T>(
                task: (port: ConfigurationRecoveryTransactionPort) => Promise<T>,
            ) => task(port),
        },
    };
    const application = new ConfigurationApplication(options);
    const request = {
        id: "repair-1",
        validationId: "receipt-1",
        base: { generationId: null, configRevision: repair.originalRevision },
        repair,
        document: { plugins: { adapters: [], protocols: [], applications: [] } },
    };
    return { application, request, source, file, original, options, recovery, state, calls };
}
describe("配置修复共用应用事务", () => {
    it.each(["candidateRevision", "configRevision"])(
        "损坏日志的 %s 不能授权覆盖第三方配置",
        async field => {
            const test = fixture("stopped");
            await test.application.apply(test.request);
            fs.writeFileSync(test.file, "external: preserved\n");
            const revision = test.source.readRaw().revision;
            const file = path.join(test.options.directory, `${test.request.id}.json`);
            const journal = JSON.parse(fs.readFileSync(file, "utf8"));
            journal.status = "running";
            journal[field] = revision;
            fs.writeFileSync(file, JSON.stringify(journal), { mode: 0o600 });
            const restarted = new ConfigurationApplication(test.options);
            expect(restarted.health().recoveryRequired).toBe(true);
            await expect(restarted.reconcileRestore(test.request.id, revision)).rejects.toThrow();
            expect(fs.readFileSync(test.file, "utf8")).toBe("external: preserved\n");
            expect(test.calls).toEqual(["stop"]);
        },
    );
    it("候选落盘但结果未确认后，冷启动对账只恢复原始字节且清除门禁", async () => {
        const test = fixture();
        const replace = test.source.replace.bind(test.source);
        vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
            replace(expected, document);
            throw new Error("模拟候选落盘后的结果丢失");
        });
        expect(await test.application.apply(test.request)).toMatchObject({
            recoveryRequired: true,
        });
        const current = test.source.readRaw().revision;
        const restarted = new ConfigurationApplication(test.options);
        const result = await restarted.reconcileRestore(test.request.id, current);
        expect(result).toMatchObject({
            status: "failed",
            rolledBack: true,
            sourceState: "damaged",
            recoveryRequired: false,
        });
        expect(test.source.readRaw().bytes).toEqual(test.original);
        expect(test.calls).toEqual(["stop"]);
        expect(restarted.health().recoveryRequired).toBe(false);
    });
    it("对账不能对已完成操作制造恢复状态", async () => {
        const test = fixture("stopped");
        const result = await test.application.apply(test.request);
        await expect(
            test.application.reconcileRestore(test.request.id, test.source.readRaw().revision),
        ).rejects.toThrow();
        expect(test.application.status(test.request.id)).toEqual(result);
        expect(test.application.health().recoveryRequired).toBe(false);
    });
    it.each(["running", "stopped"] as const)(
        "%s 的修复保持原期望，公开操作不含原文与备份引用",
        async desired => {
            const test = fixture(desired);
            const result = await test.application.apply(test.request);
            expect(result.status).toBe("succeeded");
            expect(test.calls).toEqual(desired === "running" ? ["stop", "start"] : ["stop"]);
            expect(test.source.read().document).toEqual(test.request.document);
            expect(test.recovery.read(test.request.repair)).toEqual(test.original);
            expect(JSON.stringify(result)).not.toContain("原始秘密");
            expect(JSON.stringify(result)).not.toContain(test.request.repair.backupId);
            expect(await test.application.apply(test.request)).toEqual(result);
            expect(new ConfigurationApplication(test.options).health().recoveryRequired).toBe(
                false,
            );
        },
    );
    it("新网关明确失败后恢复精确原始字节，不尝试从坏配置启动", async () => {
        const test = fixture();
        test.state.failStart = true;
        const result = await test.application.apply(test.request);
        expect(result).toMatchObject({
            status: "failed",
            rolledBack: true,
            sourceState: "damaged",
            recoveryRequired: false,
        });
        expect(fs.readFileSync(test.file)).toEqual(test.original);
        expect(test.calls).toEqual(["stop", "start"]);
        expect(test.application.health().recoveryRequired).toBe(false);
    });
    it("外部文件变化不能被回退覆盖，未知结果保持恢复门禁", async () => {
        const test = fixture();
        test.state.failStart = true;
        test.state.drift = true;
        expect(await test.application.apply(test.request)).toMatchObject({
            status: "failed",
            recoveryRequired: true,
        });
        expect(fs.readFileSync(test.file, "utf8")).toBe("external: preserved\n");
        const restarted = new ConfigurationApplication(test.options);
        expect(restarted.health().recoveryRequired).toBe(true);
        await expect(
            restarted.reconcileRestore(test.request.id, test.source.readRaw().revision),
        ).rejects.toThrow();
        expect(fs.readFileSync(test.file, "utf8")).toBe("external: preserved\n");
    });
    it("备份引用不匹配时零停机零写入，普通请求不能应用坏来源", async () => {
        const test = fixture();
        await expect(
            test.application.apply({
                ...test.request,
                repair: { ...test.request.repair, originalRevision: "0".repeat(64) },
            }),
        ).rejects.toThrow();
        const { repair: ignored, ...normal } = test.request;
        await expect(test.application.apply(normal)).rejects.toThrow();
        expect(test.calls).toEqual([]);
        expect(fs.readFileSync(test.file)).toEqual(test.original);
    });
});
