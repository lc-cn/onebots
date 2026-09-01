import * as fs from "node:fs";
import * as path from "node:path";
import { LAUNCHD_LABEL, SERVICE_NAME, type ServiceScope } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";

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

export function writePrivateJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
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
    const temporary = `${file}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, content, { encoding, mode: 0o644 });
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
