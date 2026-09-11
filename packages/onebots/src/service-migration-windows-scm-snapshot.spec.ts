import { describe, expect, it } from "vitest";
import type { ServiceSpec } from "./service-definition.js";
import {
    historicalWindowsSystemRunner,
    legacyWindowsSystemFiles,
} from "./service-migration-windows-legacy-contract.js";
import {
    createLegacyWindowsScmSnapshot,
    verifyLegacyWindowsScmSnapshot,
} from "./service-migration-windows-scm-binding.js";
import {
    parseLegacyWindowsScmSnapshot,
    parseLegacyWindowsScmInspection,
} from "./service-migration-windows-scm-snapshot.js";
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

function capture() {
    const files = legacyWindowsSystemFiles(spec, state);
    return {
        operationId: "migration-1",
        spec: structuredClone(spec),
        stateDirectory: state,
        wrapperPath: wrapper,
        inspection: {
            schemaVersion: 1,
            serviceName: "onebotsgateway.exe",
            loaded: true,
            restorationReady: false,
            state: "running",
            security: "O:SYG:SYD:(A;;GA;;;SY)",
            configuration: {
                serviceType: 16,
                startType: 2,
                errorControl: 1,
                binaryPath: `"${files.executable}"`,
                loadOrderGroup: "",
                tagId: 0,
                dependencies: ["Tcpip"],
                account: "LocalSystem",
                displayName: "onebots-gateway",
                description: "OneBots Bridge Service",
                sidType: 0,
                delayedAutoStart: false,
            },
            process: { pid: 123, created: "123456789", image: files.executable },
        },
        files: {
            definition: Buffer.from(xml),
            runner: Buffer.from(historicalWindowsSystemRunner(spec)),
            executable: Buffer.from("MZ fixture"),
        },
    };
}
describe("Windows SCM 持久恢复快照绑定", () => {
    it("round trips exact config, security, file digests and process without claiming restoration readiness", () => {
        const source = capture();
        const snapshot = createLegacyWindowsScmSnapshot(source);
        expect(parseLegacyWindowsScmSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(
            snapshot,
        );
        expect(snapshot.inspection.configuration).toEqual(source.inspection.configuration);
        expect(snapshot.inspection.restorationReady).toBe(false);
        expect(snapshot.files.executable.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(() => verifyLegacyWindowsScmSnapshot(snapshot, source)).not.toThrow();
        source.inspection.configuration.dependencies.push("changed");
        expect(snapshot.inspection.configuration.dependencies).toEqual(["Tcpip"]);
    });
    it.each([
        "operationId",
        "security",
        "pid",
        "created",
        "startType",
        "dependencies",
        "account",
        "runner",
        "definition",
        "executable",
    ])("rejects fresh evidence drift in %s", field => {
        const source = capture();
        const snapshot = createLegacyWindowsScmSnapshot(source);
        if (field === "operationId") source.operationId = "other";
        if (field === "security") source.inspection.security = "O:SYG:SYD:(A;;GA;;;BA)";
        if (field === "pid") source.inspection.process.pid++;
        if (field === "created") source.inspection.process.created = "987654321";
        if (field === "startType") source.inspection.configuration.startType = 3;
        if (field === "dependencies") source.inspection.configuration.dependencies.push("extra");
        if (field === "account")
            source.inspection.configuration.account = "NT AUTHORITY\\LocalService";
        if (field === "runner" || field === "definition" || field === "executable")
            source.files[field] = Buffer.concat([source.files[field], Buffer.from(" ")]);
        expect(() => verifyLegacyWindowsScmSnapshot(snapshot, source)).toThrow();
    });
    it.each([
        "DOMAIN\\user",
        "DOMAIN\\gmsa$",
        "NT SERVICE\\onebotsgateway.exe",
        ".\\user",
        "",
        "LocalSystem ",
    ])("rejects an account without a supported password-free restoration contract: %s", account => {
        const source = capture();
        source.inspection.configuration.account = account;
        expect(() => createLegacyWindowsScmSnapshot(source)).toThrow();
    });
    it.each(["LocalSystem", "NT AUTHORITY\\LocalService", "nt authority\\networkservice"])(
        "retains allowed account %s",
        account => {
            const source = capture();
            source.inspection.configuration.account = account;
            expect(createLegacyWindowsScmSnapshot(source).inspection.configuration.account).toBe(
                account,
            );
        },
    );
    it("rejects extra password fields, absent/ambiguous states and malformed native numbers", () => {
        const source = capture();
        expect(() =>
            parseLegacyWindowsScmInspection({ ...source.inspection, loaded: false }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmInspection({ ...source.inspection, state: "stopped" }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmInspection({ ...source.inspection, restorationReady: true }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmInspection({
                ...source.inspection,
                configuration: { ...source.inspection.configuration, password: "secret" },
            }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmInspection({
                ...source.inspection,
                configuration: { ...source.inspection.configuration, startType: "2" },
            }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmInspection({
                ...source.inspection,
                process: { ...source.inspection.process, created: "18446744073709551616" },
            }),
        ).toThrow();
        expect(
            parseLegacyWindowsScmInspection({
                ...source.inspection,
                state: "stopped",
                process: null,
            }).process,
        ).toBe(null);
    });
    it("rejects tampered persisted digest, file paths and configuration", () => {
        const snapshot = createLegacyWindowsScmSnapshot(capture());
        expect(() =>
            parseLegacyWindowsScmSnapshot({ ...snapshot, digest: "0".repeat(64) }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmSnapshot({ ...snapshot, operationId: "other" }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmSnapshot({
                ...snapshot,
                files: {
                    ...snapshot.files,
                    runner: { ...snapshot.files.runner, path: "C:\\foreign.mjs" },
                },
            }),
        ).toThrow();
        expect(() =>
            parseLegacyWindowsScmSnapshot({
                ...snapshot,
                inspection: {
                    ...snapshot.inspection,
                    configuration: { ...snapshot.inspection.configuration, startType: 4 },
                },
            }),
        ).toThrow();
    });
});
