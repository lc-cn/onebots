import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { GenerationStore } from "../installation/generation-store.js";
import {
    normalizeConfigurationSchema,
    type ConfigurationSchemaBundle,
    type VerifiedProtocolMetadata,
} from "./configuration-schema.js";

/** Schema 与映射必须同时来自收据绑定的工件，不接收客户端提供的映射。 */
export function readGenerationConfigurationSchema(
    store: Pick<GenerationStore, "readVerified">,
    generationId: string,
): ConfigurationSchemaBundle {
    try {
        const generation = store.readVerified(generationId);
        const file = path.join(generation.directory, "schemas.json");
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_048_576)
            throw new Error("schema");
        const source = fs.readFileSync(file);
        if (createHash("sha256").update(source).digest("hex") !== generation.receipt.schemasDigest)
            throw new Error("schema digest");
        const schemas: unknown = JSON.parse(source.toString("utf8"));
        if (!schemas || typeof schemas !== "object" || Array.isArray(schemas))
            throw new Error("schema");
        const metadata: unknown = (schemas as Record<string, unknown>).protocolMetadata;
        if (!Array.isArray(metadata)) throw new Error("metadata missing");
        // normalize 在可信摘要检查后仍逐项检查 metadata、重复项和 Schema 对应关系。
        return normalizeConfigurationSchema({
            schemas,
            protocols: metadata as VerifiedProtocolMetadata[],
        });
    } catch {
        throw new Error("运行版本缺少有效配置 Schema，请重新验证或安装运行版本");
    }
}
