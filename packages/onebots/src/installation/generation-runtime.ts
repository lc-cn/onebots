import fs from "node:fs";
import path from "node:path";
import {
    createGenerationPlan,
    type GenerationPlan,
    type GenerationSelection,
} from "./generation-plan.js";
import type { VerifiedGeneration } from "./generation-store.js";

/** 从已验证目录恢复启动契约，不能以当前宿主入口加载另一份宿主的扩展。 */
export function resolveGenerationRuntime(
    generation: VerifiedGeneration,
    configured: GenerationSelection,
) {
    const plan = readGenerationPlan(generation);
    const selection: GenerationSelection = { adapters: [], protocols: [], applications: [] };
    for (const type of ["adapters", "protocols", "applications"] as const) {
        if (
            !Array.isArray(configured[type]) ||
            configured[type].some(name => !plan.selection[type].includes(name))
        )
            throw new Error("配置选择的扩展不在当前运行版本内，请先安装再启用");
        selection[type] = [...configured[type]];
    }
    const entrypoint = fs.realpathSync(
        path.join(generation.directory, "node_modules/onebots/lib/gateway/entry.js"),
    );
    if (!entrypoint.startsWith(`${generation.directory}${path.sep}`))
        throw new Error("运行版本入口越界");
    return {
        entrypoint,
        runtimeRoot: generation.directory,
        dependencyVersion: generation.id,
        selection,
    };
}

export function readGenerationPlan(generation: VerifiedGeneration): GenerationPlan {
    const planPath = path.join(generation.directory, "plan.json");
    const stat = fs.lstatSync(planPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024)
        throw new Error("运行版本计划文件无效");
    const input = JSON.parse(fs.readFileSync(planPath, "utf8")) as GenerationPlan;
    const plan = createGenerationPlan({ ...input, target: input });
    if (plan.digest !== generation.planDigest || JSON.stringify(plan) !== JSON.stringify(input))
        throw new Error("运行版本计划与验证记录不一致");
    return plan;
}
