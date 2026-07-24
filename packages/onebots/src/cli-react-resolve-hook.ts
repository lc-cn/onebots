/**
 * 修复 pnpm 全局安装时 @inkjs/ui 的 phantom dependency：
 * 该包 import 'react' 却未声明依赖，pnpm 全局隔离布局下会 ERR_MODULE_NOT_FOUND。
 * 将失败的 react 解析回退到 onebots 自带的 react。
 */
import type { ResolveHook } from "node:module";

let reactParentURL = import.meta.url;

export function initialize(data: { reactParentURL?: string } | undefined): void {
    if (data?.reactParentURL) {
        reactParentURL = data.reactParentURL;
    }
}

export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
    if (specifier === "react" || specifier.startsWith("react/")) {
        try {
            return await nextResolve(specifier, context);
        } catch (error) {
            try {
                return await nextResolve(specifier, {
                    ...context,
                    parentURL: reactParentURL,
                });
            } catch {
                throw error;
            }
        }
    }
    return nextResolve(specifier, context);
};
