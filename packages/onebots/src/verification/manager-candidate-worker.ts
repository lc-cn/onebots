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

interface Request {
    root: string;
    workspace: string;
    expected: ManagerCandidateVerification;
}

const stop = () => {
    try {
        if (process.platform !== "win32") process.kill(-process.pid, "SIGKILL");
    } finally {
        process.exit(1);
    }
};

async function verify(input: Request): Promise<ManagerCandidateVerification> {
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
        if (process.platform !== "win32") prepareServiceProcessOwnershipSeed(input.workspace);
        const authentication = prepareManagerAuthenticationProbe(input.workspace);
        process.chdir(input.workspace);
        const { startControlHost: start } = await import(
            pathToFileURL(path.join(lib, "control/host.js")).href
        );
        host = await start({
            workspace: input.workspace,
            runtimeRoot: input.root,
            host: "127.0.0.1",
            port: 0,
            gatewayEntrypoint: path.join(input.workspace, "forbidden-gateway.js"),
        });
        const state = host.controller.status();
        if (state.actual !== "stopped" || state.desired !== "stopped" || state.instance)
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
            (await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(5000) })).status !==
                200
        )
            throw new Error();
        await authentication.verify(origin);
        const rejected = await fetch(`${origin}/api/control/gateway/start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
            signal: AbortSignal.timeout(5000),
        }).then(
            response => response.status >= 400,
            () => true,
        );
        if (!rejected || host.controller.status().actual !== "stopped") throw new Error();
        await host.close();
        host = undefined;
        authentication.assertPreserved();
        return input.expected;
    } catch {
        if (host) {
            try {
                await host.close();
            } catch {
                stop();
            }
        }
        throw new Error("candidate verification failed");
    }
}

const requestIndex = process.argv.indexOf("--request");
const resultIndex = process.argv.indexOf("--result");
if (requestIndex >= 0 || resultIndex >= 0) {
    if (requestIndex < 0 || resultIndex < 0 || process.argv.length !== 6) stop();
    try {
        const input = JSON.parse(
            fs.readFileSync(process.argv[requestIndex + 1], "utf8"),
        ) as Request;
        const result = await verify(input);
        fs.writeFileSync(process.argv[resultIndex + 1], JSON.stringify(result), { flag: "wx" });
        process.exit(0);
    } catch {
        stop();
    }
} else {
    if (!process.send || !process.connected) process.exit(1);
    process.once("disconnect", stop);
    process.once("SIGTERM", stop);
    process.once("message", async (input: Request) => {
        try {
            const result = await verify(input);
            process.send?.(result, () => process.exit(0));
        } catch {
            stop();
        }
    });
}
