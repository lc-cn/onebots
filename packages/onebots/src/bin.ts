#!/usr/bin/env node
"use strict";
import { writeCliError } from "./cli-output.js";
import { inspectNodeRuntime, unsupportedNodeRuntimeMessage } from "./runtime-version.js";

const runtime = inspectNodeRuntime();
if (!runtime.supported) {
    writeCliError(`[onebots] ${unsupportedNodeRuntimeMessage(runtime)}`);
    process.exitCode = 1;
} else {
    const [{ createRequire, register }, { pathToFileURL }] = await Promise.all([
        import("node:module"),
        import("node:url"),
    ]);

    // pnpm 全局安装时 @inkjs/ui 无法解析未声明的 react；在加载 Pastel/Ink 前注册回退解析
    try {
        const require = createRequire(import.meta.url);
        const reactParentURL = pathToFileURL(require.resolve("react/package.json")).href;
        register("./cli-react-resolve-hook.js", import.meta.url, {
            data: { reactParentURL },
        });
    } catch {
        // react 不可用时仍继续；后续 import 会给出更明确的错误
    }

    const { runCli } = await import("./cli.js");
    await runCli();
}
