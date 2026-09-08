import path from "node:path";
import yaml from "js-yaml";
import type { ServiceHost } from "./service-host.js";
import type { ServiceSpec } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import { parseManagerServiceSpec } from "./manager-service-spec.js";
import {
    renderManagerSystemdUnit,
    renderManagerLaunchdPlist,
} from "./manager-service-definition.js";
import { createServiceMigrationConfig } from "./service-migration-config.js";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration/configuration-document.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";
import type { ServiceMigrationTargetFile } from "./service-migration-files.js";

/** 仅由已校验的私有备份派生目标，不接受客户端任意文件目标或正文。 */
export function createServiceMigrationFilePlan(
    backup: ServiceMigrationBackup,
    host: ServiceHost,
): {
    sourceState: "ready" | "damaged";
    files: ServiceMigrationTargetFile[];
} {
    try {
        if (!["linux", "darwin"].includes(host.platform) || backup.files.length !== 3)
            throw new Error();
        const target = parseManagerServiceSpec(backup.target);
        const paths = getServiceFiles(target.scope, host);
        const byRole = new Map(backup.files.map(file => [file.role, file]));
        if (
            byRole.size !== 3 ||
            byRole.get("definition")?.path !== paths.definition ||
            byRole.get("metadata")?.path !== paths.metadata
        )
            throw new Error();
        const legacy = readLegacy(byRole.get("metadata")!.contentBase64);
        const original = byRole.get("configuration");
        if (
            !original ||
            original.path !== legacy.configPath ||
            path.dirname(legacy.configPath) !== target.workspace ||
            legacy.workingDirectory !== target.workingDirectory ||
            legacy.scope !== target.scope
        )
            throw new Error();
        const raw = Buffer.from(original.contentBase64, "base64");
        let document: ConfigurationDocument | null = null;
        try {
            document = parseConfigurationDocument(
                yaml.load(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
            );
        } catch {
            // 无法解析时仅携带已备份原始字节，不能猜插件或生成空文档。
        }
        const configPath = path.join(target.workspace, "config.yaml");
        const configBytes =
            document === null
                ? raw
                : new ConfigurationFile(configPath).serialize(
                      createServiceMigrationConfig({
                          document,
                          legacy,
                          workspace: target.workspace,
                      }).document,
                  );
        const definition =
            host.platform === "linux"
                ? renderManagerSystemdUnit(target)
                : renderManagerLaunchdPlist(
                      target,
                      path.join(paths.stateDir, "onebots.log"),
                      path.join(paths.stateDir, "onebots-error.log"),
                  );
        return {
            sourceState: document === null ? "damaged" : "ready",
            files: [
                { path: configPath, bytes: configBytes, mode: 0o600 },
                { path: paths.definition, bytes: Buffer.from(definition), mode: 0o600 },
                {
                    path: paths.metadata,
                    bytes: Buffer.from(JSON.stringify(target) + "\n"),
                    mode: 0o600,
                },
            ],
        };
    } catch {
        throw new Error("旧服务文件迁移计划无效，禁止写入");
    }
}

function readLegacy(contentBase64: string): ServiceSpec {
    const document = parseConfigurationDocument(
        JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(contentBase64, "base64")),
        ),
    );
    const required = [
        "scope",
        "configPath",
        "adapters",
        "protocols",
        "nodePath",
        "binPath",
        "workingDirectory",
    ];
    if (
        required.some(key => !Object.hasOwn(document, key)) ||
        Object.keys(document).some(key => ![...required, "applications"].includes(key)) ||
        !["user", "system"].includes(String(document.scope))
    )
        throw new Error();
    for (const key of ["configPath", "nodePath", "binPath", "workingDirectory"]) {
        const value = document[key];
        if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value))
            throw new Error();
    }
    for (const key of ["adapters", "protocols", "applications"]) {
        const value = document[key];
        if (key === "applications" && value === undefined) continue;
        if (!Array.isArray(value) || value.some(item => typeof item !== "string"))
            throw new Error();
    }
    return document as unknown as ServiceSpec;
}
