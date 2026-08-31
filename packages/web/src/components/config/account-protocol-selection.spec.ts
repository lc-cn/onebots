import { describe, expect, it } from "vitest";
import {
    getAccountProtocolSelectionState,
    resolveRequestedProtocol,
} from "./account-protocol-selection.js";

describe("account protocol selection", () => {
    it("directs an account wizard without loaded protocols to extension installation", () => {
        expect(getAccountProtocolSelectionState([], {})).toEqual({
            valid: false,
            title: "无法配置协议出口",
            description: "当前没有已加载的开放协议，请先安装协议并重启 OneBots。",
            actionLabel: "安装开放协议",
        });
    });

    it("blocks saving until one of the loaded protocols is enabled", () => {
        expect(
            getAccountProtocolSelectionState(["onebot.v11", "satori.v1"], {
                "onebot.v11": false,
                "satori.v1": false,
            }),
        ).toMatchObject({
            valid: false,
            title: "至少启用一个开放协议",
        });
    });

    it("accepts any enabled loaded protocol", () => {
        expect(
            getAccountProtocolSelectionState(["onebot.v11", "satori.v1"], {
                "satori.v1": true,
            }),
        ).toEqual({
            valid: true,
            title: "协议出口已配置",
            description: "当前账号已有可用的开放协议出口。",
        });
    });

    it("preselects only a protocol published by the loaded schema", () => {
        const protocols = ["onebot.v11", "satori.v1"];

        expect(resolveRequestedProtocol(protocols, "satori.v1")).toBe("satori.v1");
        expect(resolveRequestedProtocol(protocols, "milky.v1")).toBeNull();
        expect(resolveRequestedProtocol(protocols, "")).toBeNull();
    });
});
