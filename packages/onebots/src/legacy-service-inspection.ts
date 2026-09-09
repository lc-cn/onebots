import fs from "node:fs";
import path from "node:path";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import {
    renderLaunchdPlist,
    renderHistoricalSystemdUnit,
    renderSystemdUnit,
    type ServiceScope,
    type ServiceSpec,
} from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import { createDefaultServiceHost, type ServiceHost } from "./service-host.js";
import { readServiceMetadata } from "./service-metadata.js";

/**
 * 旧服务只读证据边界。它可以识别迁移来源，但不提供安装、启停、卸载或修复动作。
 */
export class LegacyServiceInspection {
    constructor(
        private readonly scope: ServiceScope = "user",
        private readonly host: ServiceHost = createDefaultServiceHost(),
    ) {}

    paths() {
        return getServiceFiles(this.scope, this.host);
    }

    definitionPath(_spec: ServiceSpec): string {
        if (!["linux", "darwin"].includes(this.host.platform)) {
            throw new Error("此系统不支持旧服务迁移检查");
        }
        return this.paths().definition;
    }

    readSpec(): ServiceSpec | null {
        const metadata = readServiceMetadata(this.paths().metadata);
        if (metadata.kind === "missing") return null;
        if (metadata.kind !== "legacy") throw new Error("旧服务元数据无效");
        if (metadata.spec.scope !== this.scope) throw new Error("旧服务范围与元数据不一致");
        return metadata.spec;
    }

    definitionIsCurrent(spec: ServiceSpec): boolean {
        if (spec.scope !== this.scope) return false;
        const definition = this.definitionPath(spec);
        const expected =
            this.host.platform === "linux"
                ? [renderSystemdUnit(spec), renderHistoricalSystemdUnit(spec)]
                : renderLaunchdPlist(
                      spec,
                      path.join(this.paths().stateDir, "onebots.log"),
                      path.join(this.paths().stateDir, "onebots-error.log"),
                  );
        const before = fs.lstatSync(definition);
        if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o022) !== 0)
            return false;
        const actual = new ConfigurationFile(definition).readRaw().bytes;
        const after = fs.lstatSync(definition);
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.mode !== after.mode ||
            before.size !== after.size
        )
            return false;
        return (Array.isArray(expected) ? expected : [expected]).some(candidate =>
            actual.equals(Buffer.from(candidate)),
        );
    }
}
