import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { describe, expect, it } from "vitest";
import { buildServiceArgs, type ServiceSpec } from "./service-definition.js";
import {
    buildWindowsSystemServiceOptions,
    getWindowsSystemServiceFiles,
    renderWindowsSystemRunner,
    validateWindowsSystemServiceDefinition,
} from "./windows-system-service-definition.js";

const spec: ServiceSpec = {
    scope: "system",
    configPath: path.resolve("fixtures", "One & Bots", "config.yaml"),
    adapters: ["mock"],
    protocols: ["onebot-v11"],
    nodePath: path.resolve("fixtures", "node", "node.exe"),
    binPath: path.resolve("fixtures", "onebots", "lib", "bin.js"),
    workingDirectory: path.resolve("fixtures", "One & Bots"),
};
const stateDirectory = path.resolve("fixtures", "ProgramData", "OneBots");
const wrapperPath = path.resolve("fixtures", "node-windows", "lib", "wrapper.js");

describe("Windows system service definition", () => {
    it("定位 node-windows 实际使用的 WinSW 文件", () => {
        expect(getWindowsSystemServiceFiles(spec, stateDirectory)).toEqual({
            definition: path.join(path.dirname(spec.binPath), "daemon", "onebotsgateway.xml"),
            executable: path.join(path.dirname(spec.binPath), "daemon", "onebotsgateway.exe"),
            runner: path.join(stateDirectory, "onebots-system-runner.mjs"),
        });
    });

    it("让 node-windows 启动无 scriptOptions 的稳定 runner", () => {
        const options = buildWindowsSystemServiceOptions(spec, stateDirectory);
        expect(options).toMatchObject({
            name: "onebots-gateway",
            script: path.join(stateDirectory, "onebots-system-runner.mjs"),
            execPath: spec.nodePath,
            workingDirectory: spec.workingDirectory,
            logpath: stateDirectory,
        });
        expect(options).not.toHaveProperty("scriptOptions");
    });

    it("验证完整启动契约并拒绝路径、参数或额外配置漂移", () => {
        const xml = renderFixture(spec);
        expect(validateWindowsSystemServiceDefinition(xml, spec, stateDirectory, wrapperPath)).toBe(
            true,
        );

        const mutations = [
            xml.replace(escapeXml(path.resolve(spec.nodePath)), "C:\\stale\\node.exe"),
            xml.replace(escapeXml(path.resolve(wrapperPath)), "C:\\stale\\wrapper.js"),
            xml.replace(
                escapeXml(path.join(stateDirectory, "onebots-system-runner.mjs")),
                "C:\\stale\\runner.mjs",
            ),
            xml.replace(escapeXml(spec.workingDirectory), "C:\\stale\\workdir"),
            xml.replace(escapeXml(stateDirectory), "C:\\stale\\logs"),
            xml.replace("<logmode>rotate</logmode>", "<logmode>append</logmode>"),
            xml.replace("</service>", "<env>unexpected</env></service>"),
        ];
        for (const mutation of mutations) {
            expect(
                validateWindowsSystemServiceDefinition(mutation, spec, stateDirectory, wrapperPath),
            ).toBe(false);
        }
    });

    it("通过数组无损传递包含空格的入口、配置和插件参数", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-system-runner-"));
        const workingDirectory = path.join(root, "working directory");
        fs.mkdirSync(workingDirectory);
        const entry = path.join(root, "gateway entry.mjs");
        const output = path.join(root, "captured arguments.json");
        fs.writeFileSync(
            entry,
            `import fs from "node:fs";\nconst configIndex = process.argv.indexOf("-c");\nfs.writeFileSync(process.argv[configIndex + 1], JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n`,
            "utf8",
        );
        const runnerSpec: ServiceSpec = {
            ...spec,
            configPath: output,
            adapters: ["adapter with space"],
            protocols: ["protocol with space"],
            binPath: entry,
            workingDirectory,
        };
        const runner = path.join(root, "runner.mjs");
        fs.writeFileSync(runner, renderWindowsSystemRunner(runnerSpec), "utf8");

        try {
            execFileSync(process.execPath, [runner]);
            expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual({
                argv: buildServiceArgs(runnerSpec).slice(1),
                cwd: fs.realpathSync(workingDirectory),
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

function renderFixture(serviceSpec: ServiceSpec): string {
    const files = getWindowsSystemServiceFiles(serviceSpec, stateDirectory);
    const elements = [
        ["id", "onebotsgateway.exe"],
        ["name", "onebots-gateway"],
        ["description", "OneBots Bridge Service"],
        ["executable", path.resolve(serviceSpec.nodePath)],
        ["argument", "--harmony"],
        ["argument", path.resolve(wrapperPath)],
        ["argument", "--file"],
        ["argument", files.runner],
        ["argument", "--scriptoptions="],
        ["argument", "--log"],
        ["argument", "onebots-gateway wrapper"],
        ["argument", "--grow"],
        ["argument", "0"],
        ["argument", "--wait"],
        ["argument", "5"],
        ["argument", "--maxrestarts"],
        ["argument", "-1"],
        ["argument", "--abortonerror"],
        ["argument", "n"],
        ["argument", "--stopparentfirst"],
        ["argument", "undefined"],
        ["logmode", "rotate"],
        ["logpath", stateDirectory],
        ["stoptimeout", "30sec"],
        ["workingdirectory", serviceSpec.workingDirectory],
    ];
    return `<service>\r\n${elements
        .map(([name, value]) => `\t<${name}>${escapeXml(value ?? "")}</${name}>`)
        .join("\r\n")}\r\n</service>`;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
