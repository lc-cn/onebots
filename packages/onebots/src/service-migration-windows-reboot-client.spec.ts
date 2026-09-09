import { describe, expect, it } from "vitest";
import type { ServiceHost } from "./service-host.js";
import {
    requestWindowsLegacyReboot,
    windowsMigrationHostExecutable,
} from "./service-migration-windows-reboot-client.js";
import type { LegacyWindowsScmInspection } from "./service-migration-windows-scm-snapshot.js";

const expected: LegacyWindowsScmInspection = {
    schemaVersion: 1,
    serviceName: "onebotsgateway.exe",
    loaded: true,
    restorationReady: false,
    state: "stopped",
    configuration: {
        serviceType: 16,
        startType: 3,
        errorControl: 1,
        binaryPath: "C:\\OneBots\\onebotsgateway.exe",
        loadOrderGroup: "",
        tagId: 0,
        dependencies: [],
        account: "LocalSystem",
        displayName: "onebots-gateway",
        description: "OneBots Bridge Service",
        sidType: 0,
        delayedAutoStart: false,
    },
    security: "O:SYG:SYD:P(A;;FA;;;SY)",
    process: null,
};

describe("Windows reboot receipt client", () => {
    it("sends one closed base64url request without exposing native arguments", () => {
        let decoded: Record<string, unknown> | undefined;
        const host: ServiceHost = {
            platform: "win32",
            homedir: "C:\\Users\\test",
            env: {},
            isElevated: true,
            windowsSid: "S-1-5-21-1",
            exec: (_file, args) => {
                expect(args.slice(0, 2)).toEqual(["legacy-reboot-control", "--request"]);
                decoded = JSON.parse(Buffer.from(args[2], "base64url").toString("utf8"));
                return '{"schemaVersion":1,"operationId":"op_1","phase":"restoration-ready","restorationReady":true}\n';
            },
            spawn: async () => 1,
        };
        expect(
            requestWindowsLegacyReboot(
                host,
                "C:\\OneBots\\onebots-windows-host.exe",
                {
                    operationId: "op_1",
                    stateDirectory: "C:\\ProgramData\\OneBots",
                    snapshotDigest: "a".repeat(64),
                    nonce: "b".repeat(64),
                    expected,
                },
                "inspect",
            ),
        ).toMatchObject({ restorationReady: true, phase: "restoration-ready" });
        expect(decoded).toEqual({
            schemaVersion: 1,
            operation: "inspect",
            operationId: "op_1",
            stateDirectory: "C:\\ProgramData\\OneBots",
            snapshotDigest: "a".repeat(64),
            nonce: "b".repeat(64),
            expected,
        });
    });

    it("rejects extra output lines and a receipt for another operation", () => {
        const host = {
            platform: "win32",
            isElevated: true,
            exec: () =>
                '{"schemaVersion":1,"operationId":"other","phase":"cleaned","restorationReady":true}\nnoise',
        } as unknown as ServiceHost;
        expect(() =>
            requestWindowsLegacyReboot(
                host,
                "C:\\host.exe",
                {
                    operationId: "op_1",
                    stateDirectory: "C:\\ProgramData\\OneBots",
                    snapshotDigest: "a".repeat(64),
                    nonce: "b".repeat(64),
                    expected,
                },
                "cleanup",
            ),
        ).toThrow("响应无效");
    });

    it("derives only the packaged fixed-architecture native host path", () => {
        expect(windowsMigrationHostExecutable("C:\\pkg\\lib\\bin.js")).toBe(
            `C:\\pkg\\lib\\native\\win32-${process.arch}\\onebots-windows-host.exe`,
        );
    });
});
