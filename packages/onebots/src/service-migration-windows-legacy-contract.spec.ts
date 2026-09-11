import { describe, expect, it } from "vitest";
import type { ServiceSpec } from "./service-definition.js";
import {
    historicalWindowsSystemRunner,
    legacyWindowsWrapperPath,
    legacyWindowsSystemFiles,
    validateLegacyWindowsSystemXml,
} from "./service-migration-windows-legacy-contract.js";

const spec: ServiceSpec = {
    scope: "system",
    configPath: "C:\\One Bots\\data\\custom.yaml",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    binPath: "C:\\One Bots\\lib\\bin.js",
    workingDirectory: "C:\\One Bots",
    adapters: ["mock"],
    protocols: ["onebot-v11"],
    applications: ["zhin"],
};
const state = "C:\\ProgramData\\OneBots";
const wrapper = "C:\\One Bots\\node_modules\\node-windows\\lib\\wrapper.js";
// 历史 node-windows/WinSW 文件布局；独立 fixture，不能由待测生成器构造。
const xml = `<service>
<id>onebotsgateway.exe</id><name>onebots-gateway</name>
<description>OneBots Bridge Service</description>
<executable>C:\\Program Files\\nodejs\\node.exe</executable>
<argument>--harmony</argument>
<argument>C:\\One Bots\\node_modules\\node-windows\\lib\\wrapper.js</argument>
<argument>--file</argument><argument>C:\\ProgramData\\OneBots\\onebots-system-runner.mjs</argument>
<argument>--scriptoptions=</argument><argument>--log</argument>
<argument>onebots-gateway wrapper</argument><argument>--grow</argument><argument>0</argument>
<argument>--wait</argument><argument>5</argument><argument>--maxrestarts</argument><argument>-1</argument>
<argument>--abortonerror</argument><argument>n</argument>
<argument>--stopparentfirst</argument><argument>undefined</argument>
<logmode>rotate</logmode><logpath>C:\\ProgramData\\OneBots</logpath>
<stoptimeout>30sec</stoptimeout><workingdirectory>C:\\One Bots</workingdirectory>
</service>`;

describe("历史 Windows 系统托管契约", () => {
    it("uses the old WinSW identity and bin-adjacent daemon, not the new manager definition", () => {
        expect(legacyWindowsSystemFiles(spec, state)).toEqual({
            definition: "C:\\One Bots\\lib\\daemon\\onebotsgateway.xml",
            executable: "C:\\One Bots\\lib\\daemon\\onebotsgateway.exe",
            runner: "C:\\ProgramData\\OneBots\\onebots-system-runner.mjs",
        });
        expect(validateLegacyWindowsSystemXml(xml, spec, state, wrapper)).toBe(true);
        expect(legacyWindowsWrapperPath(xml, spec, state)).toBe(wrapper);
        expect(
            validateLegacyWindowsSystemXml(xml.replaceAll("\n", "\r\n"), spec, state, wrapper),
        ).toBe(true);
    });
    it("reproduces the historical JS runner argv, working directory and Windows file URL", () => {
        const runner = historicalWindowsSystemRunner(spec);
        expect(runner).toContain(
            'process.argv = [process.execPath, entry, ...["--service-runtime","run","-c","C:\\\\One Bots\\\\data\\\\custom.yaml","-r","mock","-p","onebot-v11","-t","zhin"]];',
        );
        expect(runner).toContain('process.chdir("C:\\\\One Bots");');
        expect(runner).toContain('await import("file:///C:/One%20Bots/lib/bin.js");');
        expect(runner.endsWith("\n")).toBe(true);
    });
    it.each([
        ["onebotsgateway.exe", "onebots-gateway"],
        ["<argument>5</argument>", "<argument>6</argument>"],
        ["--scriptoptions=", "--scriptoptions=--unsafe"],
        ["wrapper.js", "other.js"],
        ["30sec", "1sec"],
        ["<logmode>rotate</logmode>", "<logmode>append</logmode>"],
        ["</service>", "<extra>true</extra></service>"],
        ["<service>", "<!DOCTYPE service><service>"],
        ["<name>onebots-gateway</name>", "<name>&unknown;</name>"],
    ])("rejects changed historical contract %s", (from, to) => {
        expect(validateLegacyWindowsSystemXml(xml.replace(from, to), spec, state, wrapper)).toBe(
            false,
        );
    });
    it.each([
        "C:relative",
        "\\\\server\\share",
        "C:\\One Bots\\..\\other",
        "C:\\a:stream",
        "C:\\trailing.",
    ])("rejects noncanonical legacy paths %s", binPath => {
        expect(() => legacyWindowsSystemFiles({ ...spec, binPath }, state)).toThrow();
    });
    it("does not reinterpret a user task as a system service", () => {
        expect(() => legacyWindowsSystemFiles({ ...spec, scope: "user" }, state)).toThrow();
        expect(
            validateLegacyWindowsSystemXml(xml, { ...spec, scope: "user" }, state, wrapper),
        ).toBe(false);
    });
});
