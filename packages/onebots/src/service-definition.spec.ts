import { describe, expect, it } from "vitest";
import {
    buildServiceArgs,
    renderLaunchdPlist,
    renderSystemdUnit,
    renderWindowsCommand,
    renderWindowsScriptOptions,
    renderWindowsTaskXml,
    type ServiceSpec,
} from "./service-definition.js";

const spec: ServiceSpec = {
    scope: "user",
    configPath: "/tmp/one bots/配置.yaml",
    adapters: ["qq", "kook"],
    protocols: ["onebot-v11"],
    nodePath: "/opt/node js/bin/node",
    binPath: "/opt/onebots/bin.js",
    workingDirectory: "/tmp/one bots",
};

describe("legacy service definition evidence", () => {
    it("retains the installed bridge and preflight arguments", () => {
        expect(buildServiceArgs(spec)).toEqual([
            spec.binPath,
            "--service-runtime",
            "run",
            "-c",
            spec.configPath,
            "-r",
            "qq",
            "-r",
            "kook",
            "-p",
            "onebot-v11",
        ]);
        expect(buildServiceArgs(spec, "preflight")[2]).toBe("preflight");
        expect(buildServiceArgs({ ...spec, applications: ["zhin"] })).toEqual([
            ...buildServiceArgs(spec),
            "-t",
            "zhin",
        ]);
    });

    it("keeps legacy platform renderers deterministic for migration comparison", () => {
        expect(renderSystemdUnit(spec)).toContain(
            'ExecStart="/opt/node js/bin/node" "/opt/onebots/bin.js" "--service-runtime"',
        );
        expect(renderLaunchdPlist(spec, "/tmp/out.log", "/tmp/error.log")).toContain(
            "/tmp/one bots/配置.yaml",
        );
        expect(renderWindowsTaskXml("C:\\One Bots\\runner.cmd")).toContain("<RestartOnFailure>");
        const windows = {
            ...spec,
            nodePath: "C:\\Program Files\\nodejs\\node.exe",
            binPath: "C:\\One Bots\\bin.js",
            configPath: "C:\\One Bots\\config.yaml",
        };
        expect(renderWindowsCommand(windows)).toContain("--service-runtime run");
        expect(renderWindowsScriptOptions(windows)).toContain('-c "C:\\One Bots\\config.yaml"');
    });
});
