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
import type { GenerationPlan } from "../installation/generation-plan.js";

interface Request {
    root: string;
    workspace: string;
    plan?: GenerationPlan;
    expected: ManagerCandidateVerification;
}

type CandidateVerificationStage =
    | "request"
    | "dependencies"
    | "package-identity"
    | "workspace"
    | "authentication"
    | "management-startup"
    | "management-state"
    | "web-page"
    | "web-asset"
    | "authentication-v2"
    | "anonymous-denied"
    | "management-close"
    | "authentication-preserved";

const verificationStages: readonly CandidateVerificationStage[] = [
    "request",
    "dependencies",
    "package-identity",
    "workspace",
    "authentication",
    "management-startup",
    "management-state",
    "web-page",
    "web-asset",
    "authentication-v2",
    "anonymous-denied",
    "management-close",
    "authentication-preserved",
];

let checkpointDirectory: string | undefined;

/**
 * 每个阶段写一个 create-only 小文件。worker 被 native watchdog 终止时，最后一个完整文件仍能
 * 证明挂起边界；文件名和内容都来自固定枚举，不包含候选路径、凭据或异常文本。
 */
function enterStage(stage: CandidateVerificationStage): CandidateVerificationStage {
    if (checkpointDirectory) {
        const ordinal = verificationStages.indexOf(stage);
        if (ordinal < 0) throw new Error("candidate verification stage invalid");
        fs.writeFileSync(
            path.join(
                checkpointDirectory,
                `checkpoint-${String(ordinal).padStart(2, "0")}-${stage}.json`,
            ),
            JSON.stringify({ schemaVersion: 1, stage }),
            { flag: "wx", mode: 0o600 },
        );
    }
    return stage;
}

class CandidateVerificationFailure extends Error {
    constructor(readonly stage: CandidateVerificationStage) {
        super("candidate verification failed");
    }
}

const stop = () => {
    try {
        if (process.platform !== "win32") process.kill(-process.pid, "SIGKILL");
    } finally {
        process.exit(1);
    }
};

async function verify(
    input: Request,
): Promise<
    ManagerCandidateVerification | { schemas: string; verification: ManagerCandidateVerification }
> {
    let host: Awaited<ReturnType<typeof startControlHost>> | undefined;
    let stage: CandidateVerificationStage = enterStage("dependencies");
    try {
        let schemas: string | undefined;
        if (input.plan) {
            const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
            const { verifyGenerationRuntime } = await import(
                new URL(
                    `../installation/generation-verification-runtime.${extension}`,
                    import.meta.url,
                ).href
            );
            schemas = await verifyGenerationRuntime(input.root, input.plan);
        }
        stage = enterStage("package-identity");
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
        stage = enterStage("workspace");
        prepareServiceMigrationWorkspace(input.workspace, randomUUID(), "stopped");
        if (process.platform !== "win32") prepareServiceProcessOwnershipSeed(input.workspace);
        stage = enterStage("authentication");
        const authentication = prepareManagerAuthenticationProbe(input.workspace);
        process.chdir(input.workspace);
        const { startControlHost: start } = await import(
            pathToFileURL(path.join(lib, "control/host.js")).href
        );
        stage = enterStage("management-startup");
        host = await start({
            workspace: input.workspace,
            runtimeRoot: input.root,
            host: "127.0.0.1",
            port: 0,
            gatewayEntrypoint: path.join(input.workspace, "forbidden-gateway.js"),
        });
        stage = enterStage("management-state");
        const state = host.controller.status();
        if (state.actual !== "stopped" || state.desired !== "stopped" || state.instance)
            throw new Error();
        const address = host.server.address();
        if (!address || typeof address === "string") throw new Error();
        const origin = `http://127.0.0.1:${address.port}`;
        stage = enterStage("web-page");
        const page = await fetch(origin, { signal: AbortSignal.timeout(5000) });
        if (page.status !== 200 || !page.headers.get("content-type")?.includes("text/html"))
            throw new Error();
        const asset = (await page.text()).match(/src="(\/assets\/[^"\s]+\.js)"/)?.[1];
        stage = enterStage("web-asset");
        if (
            !asset ||
            (await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(5000) })).status !==
                200
        )
            throw new Error();
        stage = enterStage("authentication-v2");
        await authentication.verify(origin);
        stage = enterStage("anonymous-denied");
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
        stage = enterStage("management-close");
        await host.close();
        host = undefined;
        stage = enterStage("authentication-preserved");
        authentication.assertPreserved();
        return schemas === undefined ? input.expected : { schemas, verification: input.expected };
    } catch {
        const failedStage = stage;
        if (host) {
            try {
                await host.close();
            } catch {
                throw new CandidateVerificationFailure("management-close");
            }
        }
        throw new CandidateVerificationFailure(failedStage);
    }
}

const requestIndex = process.argv.indexOf("--request");
const resultIndex = process.argv.indexOf("--result");
if (requestIndex >= 0 || resultIndex >= 0) {
    if (requestIndex < 0 || resultIndex < 0 || process.argv.length !== 6) stop();
    try {
        checkpointDirectory = path.dirname(process.argv[resultIndex + 1]);
        enterStage("request");
        const input = JSON.parse(
            fs.readFileSync(process.argv[requestIndex + 1], "utf8"),
        ) as Request;
        const result = await verify(input);
        fs.writeFileSync(process.argv[resultIndex + 1], JSON.stringify(result), { flag: "wx" });
        process.exit(0);
    } catch (error) {
        const stage = error instanceof CandidateVerificationFailure ? error.stage : "request";
        try {
            fs.writeFileSync(
                process.argv[resultIndex + 1],
                JSON.stringify({ failed: true, stage }),
                { flag: "wx" },
            );
        } catch {
            // result 路径不可写时仍须失败退出，父进程会保留整个验证目录。
        }
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
