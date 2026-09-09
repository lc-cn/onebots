export type PluginInspection =
    | {
          status: "ready";
          candidate: string;
          entryPath: string;
          packageName: string;
          version: string | null;
      }
    | { status: "broken"; candidate: string; reason: string; buildCommand?: string }
    | { status: "missing"; candidates: string[] };

export type PluginLoadResult =
    | { loaded: true; inspection: Extract<PluginInspection, { status: "ready" }> }
    | { loaded: false; inspection: PluginInspection; message: string };

export type PluginType = "adapter" | "protocol" | "application";

export interface LoadedPluginInfo {
    type: PluginType;
    name: string;
    packageName: string;
    version: string | null;
    entryPath: string;
    /** 当前进程实际成功求值的 ESM 标识；重试加载时可能包含缓存隔离参数。 */
    moduleUrl?: string;
}

export type ReadyPluginInspection = Extract<PluginInspection, { status: "ready" }>;

export interface PluginLoadOptions {
    timeoutMs?: number;
}

export const PLUGIN_LOAD_TIMEOUT_MS = 15_000;
