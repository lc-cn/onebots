import path from "node:path";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { verifyConfiguration } from "../configuration/configuration-verify.js";
import { resolveGenerationRuntime } from "../installation/generation-runtime.js";
import type { VerifiedGeneration } from "../installation/generation-store.js";
import { getConfiguredPluginSelection } from "../runtime-plugin-selection.js";

/** 在生命周期队列内验证候选宿主与当前配置；安装验证不能替代业务配置验证。 */
export class GenerationConfigurationVerifier {
    private readonly source: ConfigurationFile;
    private readonly abort = new AbortController();
    private readonly pending = new Set<Promise<unknown>>();
    constructor(
        private readonly workspace: string,
        private readonly readVerified: (id: string) => VerifiedGeneration,
        private readonly verifyRuntime = verifyConfiguration,
    ) {
        this.source = new ConfigurationFile(path.join(workspace, "config.yaml"));
    }

    verify(generation: VerifiedGeneration): Promise<() => void> {
        if (this.abort.signal.aborted) return Promise.reject(new Error("版本验证已关闭"));
        const work = this.validate(generation);
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

    private async validate(generation: VerifiedGeneration): Promise<() => void> {
        const snapshot = this.source.read();
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
