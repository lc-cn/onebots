import fs from "node:fs";
import path from "node:path";
import type { GenerationArtifact } from "./generation-plan.js";

/** 仅管理服务的受信启动配置使用，HTTP 客户端不能指定此文件。 */
export function loadRuntimeArtifacts(
    file: string,
    expected: { host: GenerationArtifact; core: GenerationArtifact },
) {
    try {
        if (!path.isAbsolute(file)) throw new Error();
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw new Error();
        const record: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!isObject(record) || record.schemaVersion !== 1) throw new Error();
        const root = fs.realpathSync(path.dirname(file));
        const artifact = (key: "host" | "core"): GenerationArtifact => {
            const entry = record[key];
            if (
                !isObject(entry) ||
                entry.name !== expected[key].name ||
                entry.version !== expected[key].version ||
                typeof entry.file !== "string" ||
                !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(entry.file) ||
                typeof entry.sha256 !== "string" ||
                !/^[a-f0-9]{64}$/.test(entry.sha256)
            )
                throw new Error();
            const source = path.join(root, entry.file);
            if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isFile())
                throw new Error();
            return {
                name: expected[key].name,
                version: expected[key].version,
                spec: `file:${source}`,
                sha256: entry.sha256,
            };
        };
        return { host: artifact("host"), core: artifact("core") };
    } catch {
        throw new Error("随产品提供的运行工件无效，请检查镜像或重新安装管理服务");
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
