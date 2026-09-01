import { describe, expect, it } from "vitest";
import { resolveManagementSnapshot } from "./management-snapshot.js";

const identity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

describe("management snapshot", () => {
    it("只接受同一应用、版本、实例和运行契约的账号与能力证据", () => {
        expect(
            resolveManagementSnapshot({
                adapterStatus: "ready",
                adapterIdentity: identity,
                adapterError: "",
                capabilityStatus: "ready",
                capabilityIdentity: identity,
                capabilityError: "",
            }),
        ).toEqual({ status: "ready", error: "" });

        expect(
            resolveManagementSnapshot({
                adapterStatus: "ready",
                adapterIdentity: identity,
                adapterError: "",
                capabilityStatus: "ready",
                capabilityIdentity: { ...identity, instanceId: "instance-b" },
                capabilityError: "",
            }),
        ).toEqual({
            status: "unavailable",
            error: "账号运行态与能力目录来自不同 OneBots 实例",
        });
    });

    it("等待任一证据完成，并保留具体请求错误", () => {
        expect(
            resolveManagementSnapshot({
                adapterStatus: "loading",
                adapterIdentity: null,
                adapterError: "",
                capabilityStatus: "ready",
                capabilityIdentity: identity,
                capabilityError: "",
            }),
        ).toEqual({ status: "loading", error: "" });
        expect(
            resolveManagementSnapshot({
                adapterStatus: "unavailable",
                adapterIdentity: null,
                adapterError: "运行态响应畸形",
                capabilityStatus: "ready",
                capabilityIdentity: identity,
                capabilityError: "",
            }),
        ).toEqual({ status: "unavailable", error: "运行态响应畸形" });
    });
});
