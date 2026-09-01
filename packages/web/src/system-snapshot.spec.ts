import { describe, expect, it } from "vitest";
import { resolveSystemSnapshot } from "./system-snapshot.js";

const identity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("system snapshot", () => {
    it("只接受与 health 相同实例的系统快照", () => {
        expect(
            resolveSystemSnapshot("ready", identity, "", {
                state: "success",
                label: "正常",
                detail: "实例 instance-a",
                identity,
            }),
        ).toEqual({ status: "ready", error: "" });
        expect(
            resolveSystemSnapshot("ready", identity, "", {
                state: "success",
                label: "正常",
                detail: "实例 instance-b",
                identity: { ...identity, instanceId: "instance-b" },
            }),
        ).toEqual({
            status: "unavailable",
            error: "系统信息与 health 来自不同 OneBots 实例",
        });
    });

    it("等待首次 health，并保留系统或 health 的失败证据", () => {
        expect(
            resolveSystemSnapshot("ready", identity, "", {
                state: "warning",
                label: "检查中",
                detail: "正在读取",
            }),
        ).toEqual({ status: "loading", error: "" });
        expect(
            resolveSystemSnapshot("unavailable", null, "响应畸形", {
                state: "danger",
                label: "不可达",
                detail: "health 不可达",
            }),
        ).toEqual({ status: "unavailable", error: "响应畸形" });
    });
});
