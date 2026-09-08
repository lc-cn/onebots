import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { prepareServiceMigrationWorkspace } from "../service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "../service-migration-processes.js";
import type { ManagerCandidateVerification } from "./manager-candidate.js";
import type { startControlHost } from "../control/host.js";
import { prepareManagerAuthenticationProbe } from "./manager-authentication.js";

if (!process.send || !process.connected) process.exit(1);
const stop = () => {
    try {
        process.kill(-process.pid, "SIGKILL");
    } finally {
        process.exit(1);
    }
};
process.once("disconnect", stop);
process.once("SIGTERM", stop);
process.once(
    "message",
    async (input: { root: string; workspace: string; expected: ManagerCandidateVerification }) => {
        let host: Awaited<ReturnType<typeof startControlHost>> | undefined;
        try {
            const require = createRequire(path.join(input.root, "package.json"));
            const entry = fs.realpathSync(require.resolve("onebots"));
            if (!entry.startsWith(`${input.root}${path.sep}`)) throw new Error();
            const lib = path.dirname(entry);
            const manifest = JSON.parse(fs.readFileSync(path.join(lib, "../package.json"), "utf8"));
            const corePath = createRequire(entry)
                .resolve.paths("@onebots/core")
                ?.map(directory => path.join(directory, "@onebots/core/package.json"))
                .find(file => fs.existsSync(file));
            if (!corePath) throw new Error();
            const coreFile = fs.realpathSync(corePath);
            if (!coreFile.startsWith(`${input.root}${path.sep}`)) throw new Error();
            const core = JSON.parse(fs.readFileSync(coreFile, "utf8"));
            if (
                manifest.name !== "onebots" ||
                manifest.version !== input.expected.hostVersion ||
                core.name !== "@onebots/core" ||
                core.version !== input.expected.coreVersion ||
                manifest.dependencies?.["@onebots/core"] !== core.version
            )
                throw new Error();
            prepareServiceMigrationWorkspace(input.workspace, randomUUID(), "stopped");
            prepareServiceProcessOwnershipSeed(input.workspace);
            const authentication = prepareManagerAuthenticationProbe(input.workspace);
            process.chdir(input.workspace);
            const { startControlHost: start } = await import(
                pathToFileURL(path.join(lib, "control/host.js")).href
            );
            const { createLocalControlClient } = await import(
                pathToFileURL(path.join(lib, "client/local-control.js")).href
            );
            host = await start({
                workspace: input.workspace,
                runtimeRoot: input.root,
                host: "127.0.0.1",
                port: 0,
                // 即使候选错误地尝试自动启动，也不能加载业务网关入口。
                gatewayEntrypoint: path.join(input.workspace, "forbidden-gateway.js"),
            });
            if (!host) throw new Error();
            const state = await createLocalControlClient(input.workspace).status();
            if (
                state.gateway.actual !== "stopped" ||
                state.gateway.desired !== "stopped" ||
                state.gateway.instance
            )
                throw new Error();
            const address = host.server.address();
            if (!address || typeof address === "string") throw new Error();
            const origin = `http://127.0.0.1:${address.port}`;
            const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
            if (page.status !== 200 || !page.headers.get("content-type")?.includes("text/html"))
                throw new Error();
            const asset = (await page.text()).match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
            if (
                !asset ||
                (await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(5000) }))
                    .status !== 200
            )
                throw new Error();
            await authentication.verify(origin);
            // 维护期不能通过本地请求启动网关或开放配置写入。
            let rejected = false;
            try {
                await createLocalControlClient(input.workspace).gateway("start");
            } catch {
                rejected = true;
            }
            if (!rejected || host.controller.status().actual !== "stopped") throw new Error();
            await host.close();
            host = undefined;
            authentication.assertPreserved();
            process.send?.(input.expected, () => process.exit(0));
        } catch {
            // 不将候选异常、路径或配置内容发送给父进程。
            if (host) {
                try {
                    await host.close();
                } catch {
                    stop();
                }
            }
            process.exit(1);
        }
    },
);
