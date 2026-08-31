import { describe, expect, it } from "vitest";
import { getBotOnboardingState, isAccountWizardRequest } from "./bot-onboarding.js";

describe("bot onboarding empty state", () => {
    it("routes a first deployment to platform installation", () => {
        expect(getBotOnboardingState(false)).toEqual({
            description: "先比较平台能力，再安装适配器并创建机器人账号。",
            actionLabel: "安装平台适配器",
            route: "/extensions",
        });
    });

    it("routes a deployment with adapters to account configuration", () => {
        expect(getBotOnboardingState(true)).toEqual({
            description: "适配器已经加载，可以继续创建机器人账号。",
            actionLabel: "添加机器人账号",
            route: "/config?add=",
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
