/** Pastel 路由共享的 OneBots 命令选项 schema。 */
import { option } from "pastel";
import { z } from "zod";

/** 所有需要配置、adapter 和 protocol 的路由共享 schema。 */
export const runtimeOptions = z.object({
    config: z.string().optional().describe(option({ alias: "c", description: "配置文件路径", valueDescription: "path" })),
    register: z.array(z.string()).default([]).describe(option({ alias: "r", description: "注册适配器（可多次）", valueDescription: "adapter" })),
    protocol: z.array(z.string()).default([]).describe(option({ alias: "p", description: "注册协议（可多次）", valueDescription: "protocol" })),
});

/** 用户级/系统级服务 scope 的共享 schema。 */
export const scopeOptions = z.object({
    system: z.boolean().describe(option({ description: "操作系统级服务" })),
});

/** 同时需要 runtime 参数与服务 scope 的组合 schema。 */
export const scopedRuntimeOptions = runtimeOptions.extend(scopeOptions.shape);

/** runtime 路由解析后的类型。 */
export type RuntimeOptions = z.infer<typeof runtimeOptions>;
/** scope 路由解析后的类型。 */
export type ScopeOptions = z.infer<typeof scopeOptions>;
