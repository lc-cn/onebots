import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { renderWindowsScriptOptions, type ServiceSpec } from "./service-definition.js";
import {
    getWindowsSystemServiceFiles,
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
        expect(getWindowsSystemServiceFiles(spec)).toEqual({
            definition: path.join(path.dirname(spec.binPath), "daemon", "onebotsgateway.xml"),
            executable: path.join(path.dirname(spec.binPath), "daemon", "onebotsgateway.exe"),
        });
    });

    it("验证完整启动契约并拒绝路径、参数或额外配置漂移", () => {
        const xml = renderFixture(spec);
        expect(validateWindowsSystemServiceDefinition(xml, spec, stateDirectory, wrapperPath)).toBe(
            true,
        );

        const mutations = [
            xml.replace(escapeXml(path.resolve(spec.nodePath)), "C:\\stale\\node.exe"),
            xml.replace(escapeXml(path.resolve(spec.binPath)), "C:\\stale\\bin.js"),
            xml.replace("-r mock", "-r stale"),
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
});

function renderFixture(serviceSpec: ServiceSpec): string {
    const scriptOptions = renderWindowsScriptOptions(serviceSpec);
    const elements = [
        ["id", "onebotsgateway.exe"],
        ["name", "onebots-gateway"],
        ["description", "OneBots Bridge Service"],
        ["executable", path.resolve(serviceSpec.nodePath)],
        ["argument", "--harmony"],
        ["argument", path.resolve(wrapperPath)],
        ["argument", "--file"],
        ["argument", path.resolve(serviceSpec.binPath)],
        ["argument", `--scriptoptions=${scriptOptions}`],
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
