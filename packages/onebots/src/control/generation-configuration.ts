import path from "node:path";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { ConfigurationConflictError } from "../configuration/configuration-store.js";
import {
    verifyConfiguration,
    recoverConfigurationVerifications,
} from "../configuration/configuration-verify.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { getConfiguredPluginSelection } from "../runtime-plugin-selection.js";
import type { ConfigurationImpact } from "@onebots/core";

/** 使用所选运行版本隔离验证配置；激活复核与应用 CAS 仍由生命周期事务保护。 */
export class GenerationConfigurationVerifier {
    private readonly source: ConfigurationFile;
    private readonly abort = new AbortController();
    private readonly pending = new Set<Promise<unknown>>();
    private workersBlocked = false;
    constructor(
        private readonly workspace: string,
        private readonly readVerified: (id: string) => VerifiedGeneration,
        private readonly verifyRuntime = verifyConfiguration,
        private readonly bundledRuntimeRoot = path.resolve(import.meta.dirname, "../.."),
    ) {
        this.source = new ConfigurationFile(path.join(workspace, "config.yaml"));
        // 宿主在工作区独占锁下构造本服务；冷恢复不能遗漏影响规划的独立私有目录。
        this.recoverWorkers();
    }

    verify(generation: VerifiedGeneration, expectedConfigRevision?: string): Promise<() => void> {
        if (this.abort.signal.aborted) return Promise.reject(new Error("版本验证已关闭"));
        // 当前进程已登记的 worker 由 pending/close 管理；不能把并发规划误认成冷启动孤儿。
        if (this.pending.size === 0) this.recoverWorkers();
        if (this.workersBlocked) return Promise.reject(new Error("配置验证进程归属尚待核实"));
        const work = this.validate(generation, expectedConfigRevision);
        this.pending.add(work);
        void work
            .finally(() => this.pending.delete(work))
            .catch(() => {
                // 原始 Promise 的异常由激活调用者处理；这里仅维护待完成集合。
            });
        return work;
    }

    async close(): Promise<void> {
        this.abort.abort();
        await Promise.allSettled([...this.pending]);
    }

    /** 应用前重新使用隔离运行版本注册表规划，不能信任可变验证收据中的影响。 */
    planImpact(
        generation: VerifiedGeneration | null,
        before: Record<string, unknown>,
        after: Record<string, unknown>,
    ): Promise<ConfigurationImpact> {
        if (this.abort.signal.aborted) return Promise.reject(new Error("版本验证已关闭"));
        if (this.pending.size === 0) this.recoverWorkers();
        if (this.workersBlocked) return Promise.reject(new Error("配置验证进程归属尚待核实"));
        const configured = getConfiguredPluginSelection(after, true);
        let previous: ReturnType<typeof getConfiguredPluginSelection>;
        try {
            previous = getConfiguredPluginSelection(before, true);
        } catch {
            // 语义损坏的旧 plugins 不应阻止有效候选修复；隔离 worker 独立核实坏基线。
        }
        const selection = {
            adapters: [
                ...new Set([...(previous?.adapters ?? []), ...(configured?.adapters ?? [])]),
            ],
            protocols: [
                ...new Set([...(previous?.protocols ?? []), ...(configured?.protocols ?? [])]),
            ],
            applications: [
                ...new Set([
                    ...(previous?.applications ?? []),
                    ...(configured?.applications ?? []),
                ]),
            ],
        };
        const runtime = generation
            ? resolveGenerationRuntime(generation, selection)
            : { runtimeRoot: this.bundledRuntimeRoot, selection };
        const privateRoot = path.join(
            this.workspace,
            ".control",
            "application-verification-workers",
        );
        const work = this.verifyRuntime({
            ...runtime,
            hostEntrypoint: generation
                ? undefined
                : path.resolve(import.meta.dirname, "../../lib/index.js"),
            privateRoot,
            document: after,
            previousDocument: before,
            signal: this.abort.signal,
            // 规划有界且不信任调用方回执；进入生命周期队列后仍复核源版本与运行版本。
            timeoutMs: 15_000,
        }).then(result => {
            if (!result.valid || !result.impact) throw new Error("配置影响无法确认，请重新验证");
            return result.impact;
        });
        this.pending.add(work);
        void work
            .finally(() => this.pending.delete(work))
            .catch(() => {
                // 异常交给应用事务处理，这里只清理生命周期登记。
            });
        return work;
    }

    private recoverWorkers(): void {
        if (process.platform === "win32") return; // 当前隔离验证不创建 Windows worker。
        for (const name of [
            "activation-verification-workers",
            "application-verification-workers",
        ]) {
            try {
                if (
                    recoverConfigurationVerifications(path.join(this.workspace, ".control", name))
                        .blocked.length
                )
                    this.workersBlocked = true;
            } catch {
                // 保留所有权记录与敏感请求，不推断历史进程已经退出。
                this.workersBlocked = true;
            }
        }
    }

    private async validate(
        generation: VerifiedGeneration,
        expectedConfigRevision?: string,
    ): Promise<() => void> {
        const snapshot = this.source.read();
        if (expectedConfigRevision !== undefined && expectedConfigRevision !== snapshot.revision)
            throw new ConfigurationConflictError();
        const fingerprint = JSON.stringify(generation);
        const configured = getConfiguredPluginSelection(snapshot.document, true);
        const runtime = resolveGenerationRuntime(generation, {
            adapters: configured?.adapters ?? [],
            protocols: configured?.protocols ?? [],
            applications: configured?.applications ?? [],
        });
        const assertCurrent = () => {
            if (this.abort.signal.aborted) throw new Error("版本验证已关闭");
            if (this.source.readRaw().revision !== snapshot.revision)
                throw new Error("配置已变化，请重新确认版本切换");
            if (JSON.stringify(this.readVerified(generation.id)) !== fingerprint)
                throw new Error("候选版本验证记录已变化，请重新安装验证");
        };
        assertCurrent();
        const result = await this.verifyRuntime({
            runtimeRoot: runtime.runtimeRoot,
            selection: runtime.selection,
            document: snapshot.document,
            privateRoot: path.join(this.workspace, ".control", "activation-verification-workers"),
            signal: this.abort.signal,
        });
        assertCurrent();
        if (!result.valid)
            throw new Error("当前配置不兼容候选运行版本，请先修复配置或选择兼容版本");
        return assertCurrent;
    }
}
