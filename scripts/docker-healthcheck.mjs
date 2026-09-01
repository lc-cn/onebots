import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../packages/onebots/package.json", import.meta.url));
const yaml = require("js-yaml");

export const DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES = 64 * 1024;

export function readConfig(env = process.env) {
    const configPath = env.ONEBOTS_CONFIG_PATH || "/data/config.yaml";
    if (!fs.existsSync(configPath)) return {};
    const parsed = yaml.load(fs.readFileSync(configPath, "utf8"));
    if (parsed === undefined || parsed === null) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`配置根节点不是对象: ${configPath}`);
    }
    return parsed;
}

export function readinessUrl(config, env = process.env) {
    if (env.ONEBOTS_HEALTHCHECK_URL) return env.ONEBOTS_HEALTHCHECK_URL;
    const port = env.PORT || config.port || 6727;
    const configuredPath = String(env.ONEBOTS_PATH ?? config.path ?? "").trim();
    const prefix = configuredPath ? `/${configuredPath.replace(/^\/+|\/+$/g, "")}` : "";
    return `http://127.0.0.1:${port}${prefix}/ready`;
}

export async function checkReadiness({
    env = process.env,
    config = readConfig(env),
    fetcher = fetch,
} = {}) {
    const url = readinessUrl(config, env);
    const response = await fetcher(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(3000),
    });
    const body = await readBoundedResponseBody(response);
    if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}: ${body.slice(0, 300)}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const mediaType = contentType.split(";", 1)[0].trim();
    if (mediaType !== "application/json") {
        throw new Error(
            `${url} Content-Type 不是 application/json（实际为 ${contentType || "缺失"}）`,
        );
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch {
        throw new Error(`${url} 未返回 JSON`);
    }
    if (payload?.ready !== true) throw new Error(`${url} 未声明 ready=true`);
    if (payload?.application !== "onebots") throw new Error(`${url} 未声明 onebots 应用身份`);
    if (typeof payload?.version !== "string" || !payload.version.trim()) {
        throw new Error(`${url} 未声明运行版本`);
    }
    if (typeof payload?.instance_id !== "string" || !payload.instance_id.trim()) {
        throw new Error(`${url} 未声明 instance_id`);
    }
}

async function readBoundedResponseBody(response) {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES) {
        await response.body?.cancel();
        throw new Error(`响应正文超过 ${DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES} 字节上限`);
    }
    if (!response.body) return "";

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES) {
                await reader.cancel();
                throw new Error(`响应正文超过 ${DOCKER_HEALTHCHECK_BODY_LIMIT_BYTES} 字节上限`);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, total).toString("utf8");
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    checkReadiness().catch(error => {
        console.error(
            `[onebots-healthcheck] ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
    });
}
