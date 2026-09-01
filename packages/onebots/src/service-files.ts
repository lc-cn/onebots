import * as fs from "node:fs";
import * as path from "node:path";
import { LAUNCHD_LABEL, SERVICE_NAME, type ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
import { inspectServiceDefinitionDirectoryPermissions } from "./doctor-service-definition.js";

export interface ServiceFiles {
    stateDir: string;
    definition: string;
    metadata: string;
}

export function getServiceFiles(scope: ServiceScope, host: ServiceHost): ServiceFiles {
    if (host.platform === "linux") {
        const stateDir =
            scope === "system"
                ? "/var/lib/onebots"
                : path.join(
                      host.env.XDG_STATE_HOME || path.join(host.homedir, ".local", "state"),
                      "onebots",
                  );
        const definition =
            scope === "system"
                ? path.join("/etc/systemd/system", `${SERVICE_NAME}.service`)
                : path.join(
                      host.env.XDG_CONFIG_HOME || path.join(host.homedir, ".config"),
                      "systemd",
                      "user",
                      `${SERVICE_NAME}.service`,
                  );
        return { stateDir, definition, metadata: path.join(stateDir, "service.json") };
    }
    if (host.platform === "darwin") {
        const stateDir =
            scope === "system"
                ? "/Library/Application Support/OneBots"
                : path.join(host.homedir, "Library", "Application Support", "OneBots");
        const definition =
            scope === "system"
                ? path.join("/Library/LaunchDaemons", `${LAUNCHD_LABEL}.plist`)
                : path.join(host.homedir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
        return { stateDir, definition, metadata: path.join(stateDir, "service.json") };
    }
    const stateDir =
        scope === "system"
            ? path.join(host.env.ProgramData || "C:\\ProgramData", "OneBots")
            : path.join(
                  host.env.LOCALAPPDATA || path.join(host.homedir, "AppData", "Local"),
                  "OneBots",
              );
    return {
        stateDir,
        definition: path.join(stateDir, "onebots-service.xml"),
        metadata: path.join(stateDir, "service.json"),
    };
}

/** 仅收紧最终状态目录，避免递归创建时把 XDG 等共享父目录也设为私有。 */
export function ensurePrivateServiceDirectory(directory: string): void {
    if (fs.existsSync(directory)) {
        if (!fs.statSync(directory).isDirectory()) {
            throw new Error(`服务状态路径不是目录: ${directory}`);
        }
        return;
    }
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    try {
        fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!fs.statSync(directory).isDirectory()) throw error;
    }
}

export function writePrivateJson(file: string, value: unknown): void {
    ensurePrivateServiceDirectory(path.dirname(file));
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
            encoding: "utf8",
            mode: 0o600,
        });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

export function writeServiceFile(
    file: string,
    content: string,
    encoding: BufferEncoding = "utf8",
): void {
    if (process.platform !== "win32") {
        const directoryCheck = inspectServiceDefinitionDirectoryPermissions(file);
        if (directoryCheck.level === "error") throw new Error(directoryCheck.message);
    }
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, content, { encoding, mode: 0o644 });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
