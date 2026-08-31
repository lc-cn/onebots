import { describe, expect, it } from "vitest";
import { getBotOnboardingState, isAccountWizardRequest } from "./bot-onboarding.js";

describe("bot onboarding empty state", () => {
    it("routes a first deployment to platform installation", () => {
        expect(getBotOnboardingState(false, "loading")).toEqual({
            description: "先比较平台能力，再安装适配器并创建机器人账号。",
            actionLabel: "安装平台适配器",
            route: "/extensions?type=adapter",
            actionDisabled: false,
        });
    });

    it("waits for protocol inventory before offering account configuration", () => {
        expect(getBotOnboardingState(true, "loading")).toEqual({
            description: "适配器已经加载，正在确认可用的开放协议。",
            actionLabel: "正在检查协议",
            route: "/extensions?type=protocol",
            actionDisabled: true,
        });
    });

    it("routes a deployment without protocols to protocol installation", () => {
        expect(getBotOnboardingState(true, "missing")).toEqual({
            description: "适配器已经加载；请先安装至少一个开放协议，再创建机器人账号。",
            actionLabel: "安装开放协议",
            route: "/extensions?type=protocol",
            actionDisabled: false,
        });
    });

    it("routes an unavailable inventory to a recoverable extension check", () => {
        expect(getBotOnboardingState(true, "unavailable")).toEqual({
            description: "无法确认开放协议是否已加载，请先检查功能扩展。",
            actionLabel: "检查功能扩展",
            route: "/extensions?type=protocol",
            actionDisabled: false,
        });
    });

    it("offers account configuration only after adapters and protocols are loaded", () => {
        expect(getBotOnboardingState(true, "available")).toEqual({
            description: "适配器与开放协议已经加载，可以继续创建机器人账号。",
            actionLabel: "添加机器人账号",
            route: "/config?add=",
            actionDisabled: false,
        });
    });
});

describe("account wizard request", () => {
    const availablePlatforms = ["mock", "telegram"];

    it("accepts the generic add-account route", () => {
        expect(isAccountWizardRequest("", availablePlatforms)).toBe(true);
    });

    it("accepts a loaded adapter and rejects an unavailable one", () => {
        expect(isAccountWizardRequest("telegram", availablePlatforms)).toBe(true);
        expect(isAccountWizardRequest("discord", availablePlatforms)).toBe(false);
    });

    it("rejects repeated or missing query values", () => {
        expect(isAccountWizardRequest(["telegram"], availablePlatforms)).toBe(false);
        expect(isAccountWizardRequest(undefined, availablePlatforms)).toBe(false);
    });
});
