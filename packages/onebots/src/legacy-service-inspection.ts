import fs from "node:fs";
import path from "node:path";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import {
    LAUNCHD_LABEL,
    SERVICE_NAME,
    renderLaunchdPlist,
    renderSystemdUnit,
    type ServiceScope,
    type ServiceSpec,
    type ServiceStatus,
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
                ? renderSystemdUnit(spec)
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
        return actual.equals(Buffer.from(expected));
    }

    /** 仅供尚未清理的旧 doctor 使用；不改变平台状态。 */
    status(spec: ServiceSpec | null = this.readSpec()): ServiceStatus {
        if (!spec)
            return { installed: false, running: false, scope: this.scope, detail: "服务未安装" };
        try {
            if (this.host.platform === "linux") {
                const detail = this.host
                    .exec("systemctl", [
                        ...(this.scope === "user" ? ["--user"] : []),
                        "show",
                        "--property=ActiveState",
                        "--value",
                        SERVICE_NAME,
                    ])
                    .trim();
                return { installed: true, running: detail === "active", scope: this.scope, detail };
            }
            if (this.host.platform === "darwin") {
                const detail = this.host
                    .exec("launchctl", [
                        "print",
                        `${this.scope === "system" ? "system" : `gui/${this.host.uid}`}/${LAUNCHD_LABEL}`,
                    ])
                    .trim();
                return {
                    installed: true,
                    running: /\bstate\s*=\s*running\b/iu.test(detail),
                    scope: this.scope,
                    detail,
                };
            }
            throw new Error("此系统不支持旧服务状态检查");
        } catch (error) {
            if (this.host.platform === "darwin" && launchdTaskIsNotLoaded(error))
                return {
                    installed: true,
                    running: false,
                    scope: this.scope,
                    detail: "launchd 任务未加载",
                };
            return {
                installed: true,
                running: false,
                scope: this.scope,
                detail: "旧服务状态无法确认",
                error: "进程管理器状态查询失败",
            };
        }
    }
}

/** 原始命令错误只用于分类；任何分支都不向调用者返回其正文。 */
function launchdTaskIsNotLoaded(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const fields: unknown[] = [
        "stderr" in error ? error.stderr : undefined,
        "stdout" in error ? error.stdout : undefined,
        error.message,
    ];
    return fields.some(value => {
        const text =
            typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString() : "";
        return /could not find service|service .*not found|unknown service|no such process/iu.test(
            text,
        );
    });
}
