import { builtinEnvironments, type Environment } from "vitest/runtime";

/** 用 Vue 自定义宿主验证客户端事件；不模拟浏览器排版，不替代真实浏览器验收。 */
export default {
    ...builtinEnvironments.node,
    name: "client-renderer",
    viteEnvironment: "client",
} satisfies Environment;
