import path from "node:path";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { ConfigurationConflictError } from "../configuration/configuration-store.js";
import { verifyConfiguration } from "../configuration/configuration-verify.js";
import { recoverConfigurationVerifications } from "../configuration/configuration-verify.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { getConfiguredPluginSelection } from "../runtime-plugin-selection.js";
import type { ConfigurationImpact } from "@onebots/core";

/** 在生命周期队列内验证候选宿主与当前配置；安装验证不能替代业务配置验证。 */
export class GenerationConfigurationVerifier {
    private readonly source: ConfigurationFile;
    private readonly abort = new AbortController();
    private readonly pending = new Set<Promise<unknown>>();
    constructor(
        private readonly workspace: string,
        private readonly readVerified: (id: string) => VerifiedGeneration,
        private readonly verifyRuntime = verifyConfiguration,
        private readonly bundledRuntimeRoot = path.resolve(import.meta.dirname, "../.."),
    ) {
        this.source = new ConfigurationFile(path.join(workspace, "config.yaml"));
    }

    verify(generation: VerifiedGeneration, expectedConfigRevision?: string): Promise<() => void> {
        if (this.abort.signal.aborted) return Promise.reject(new Error("版本验证已关闭"));
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
        const configured = getConfiguredPluginSelection(after, true);
        const selection = {
            adapters: configured?.adapters ?? [],
            protocols: configured?.protocols ?? [],
            applications: configured?.applications ?? [],
        };
        const runtime = generation
            ? resolveGenerationRuntime(generation, selection)
            : { runtimeRoot: this.bundledRuntimeRoot, selection };
        const privateRoot = path.join(
            this.workspace,
            ".control",
            "application-verification-workers",
        );
        const recovery = recoverConfigurationVerifications(privateRoot);
        if (recovery.blocked.length)
            return Promise.reject(new Error("配置影响检查进程或临时文件归属尚待核实"));
        const work = this.verifyRuntime({
            ...runtime,
            hostEntrypoint: generation
                ? undefined
                : path.resolve(import.meta.dirname, "../../lib/index.js"),
            privateRoot,
            document: after,
            previousDocument: before,
            signal: this.abort.signal,
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
