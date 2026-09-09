import { describe, expect, it } from "vitest";
import { parseWindowsMigrationRecord } from "./service-migration-windows-state.js";

function record() {
    return {
        schemaVersion: 1,
        id: "migration-1",
        phase: "awaiting-restart",
        status: "running",
        recoveryRequired: false,
        restorationReady: false,
        nonce: "a".repeat(64),
        snapshotDigest: "b".repeat(64),
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "system",
            workspace: "/onebots/data",
            workingDirectory: "/onebots/runtime",
            nodePath: "/node",
            binPath: "/onebots/runtime/onebots.exe",
            host: "127.0.0.1",
            port: 6727,
        },
    };
}

describe("Windows 迁移状态闭合契约", () => {
    it("接受重启前记录且不把它声明为 restoration ready", () => {
        expect(parseWindowsMigrationRecord(record())).toMatchObject({
            phase: "awaiting-restart",
            restorationReady: false,
        });
    });

    it.each([
        { phase: "completed", status: "running" },
        { phase: "completed", status: "succeeded", recoveryRequired: true },
        { phase: "rolled-back", status: "succeeded" },
        { phase: "captured", status: "succeeded" },
        { phase: "awaiting-restart", restorationReady: true },
    ])("拒绝语义冲突的终态或重启证明 %#", changed => {
        expect(() => parseWindowsMigrationRecord({ ...record(), ...changed })).toThrow(
            "Windows 旧服务迁移状态无法核实",
        );
    });
});
