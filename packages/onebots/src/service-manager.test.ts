import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    buildServiceArgs,
    renderLaunchdPlist,
    renderSystemdUnit,
    renderWindowsTaskXml,
    type ServiceSpec,
    ServiceController,
    type ServiceHost,
} from "./service-manager.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const spec: ServiceSpec = {
    scope: "user",
    configPath: "/tmp/one bots/配置.yaml",
    adapters: ["qq", "kook"],
    protocols: ["onebot-v11"],
    nodePath: "/opt/node js/bin/node",
    binPath: "/opt/onebots/bin.js",
    workingDirectory: "/tmp/one bots",
};

describe("service definition", () => {
    it("runs the same bridge arguments that the user installed", () => {
        expect(buildServiceArgs(spec)).toEqual([
            "/opt/onebots/bin.js",
            "--service-runtime",
            "run",
            "-c",
            "/tmp/one bots/配置.yaml",
            "-r",
            "qq",
            "-r",
            "kook",
            "-p",
            "onebot-v11",
        ]);
    });

    it("quotes systemd paths without losing arguments", () => {
        const unit = renderSystemdUnit(spec);
        expect(unit).toContain('ExecStart="/opt/node js/bin/node" "/opt/onebots/bin.js" "--service-runtime" "run" "-c" "/tmp/one bots/配置.yaml"');
        expect(unit).toContain("Restart=on-failure");
        expect(unit).toContain("TimeoutStopSec=30");
    });

    it("escapes launchd XML values", () => {
        const plist = renderLaunchdPlist({ ...spec, configPath: "/tmp/a&b/config.yaml" }, "/tmp/out.log", "/tmp/error.log");
        expect(plist).toContain("/tmp/a&amp;b/config.yaml");
        expect(plist).toContain("<key>SuccessfulExit</key>");
        expect(plist).not.toContain("<string>gateway</string>");
    });

    it("restarts a Windows user task after bridge failures", () => {
        const xml = renderWindowsTaskXml("C:\\One Bots\\runner.cmd");
        expect(xml).toContain("<RestartOnFailure>");
        expect(xml).toContain("<Interval>PT5S</Interval>");
        expect(xml).toContain("C:\\One Bots\\runner.cmd");
    });

    it("installs without starting and keeps user data when uninstalled", async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-service-test-"));
        temporaryDirectories.push(home);
        const commands: string[] = [];
        const host: ServiceHost = {
            platform: "linux", homedir: home, uid: 501, env: {},
            exec(file, args) { commands.push([file, ...args].join(" ")); return args.includes("is-active") ? "inactive\n" : ""; },
            async spawn() { return 0; },
        };
        const controller = new ServiceController("user", host);
        const userConfig = path.join(home, "bridge", "config.yaml");
        fs.mkdirSync(path.dirname(userConfig), { recursive: true });
        fs.writeFileSync(userConfig, "port: 6727\n");

        await controller.install({ ...spec, configPath: userConfig, workingDirectory: path.dirname(userConfig) });
        expect(commands.some(command => command.endsWith("enable onebots-gateway"))).toBe(true);
        expect(commands.some(command => command.endsWith("start onebots-gateway"))).toBe(false);

        await controller.uninstall();
        expect(fs.existsSync(userConfig)).toBe(true);
        expect(controller.status().installed).toBe(false);
    });
});
