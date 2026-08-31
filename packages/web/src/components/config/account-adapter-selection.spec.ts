import { describe, expect, it } from "vitest";
import { getAccountAdapterSelectionState } from "./account-adapter-selection.js";

describe("account adapter selection", () => {
    it("does not mistake an unfinished schema request for a missing adapter", () => {
        const state = getAccountAdapterSelectionState("loading", [], "");

        expect(state).toMatchObject({
            valid: false,
            variant: "info",
            title: "正在确认可用平台",
        });
        expect(state).not.toHaveProperty("action");
    });

    it("offers a retry when adapter availability cannot be loaded", () => {
        expect(getAccountAdapterSelectionState("error", [], "")).toMatchObject({
            valid: false,
            title: "无法确认可用平台",
            action: "retry",
            actionLabel: "重新读取",
        });
    });

    it("routes a confirmed empty deployment to adapter installation", () => {
        expect(getAccountAdapterSelectionState("ready", [], "")).toMatchObject({
            valid: false,
            title: "尚未加载平台适配器",
            action: "install",
            actionLabel: "安装平台适配器",
        });
    });

    it("blocks editing an account whose adapter is no longer loaded", () => {
        expect(getAccountAdapterSelectionState("ready", ["mock"], "telegram")).toMatchObject({
            valid: false,
            title: "账号对应的适配器未加载",
            action: "install",
        });
    });

    it("accepts an empty or loaded platform selection when adapters are available", () => {
        expect(getAccountAdapterSelectionState("ready", ["mock"], "").valid).toBe(true);
        expect(getAccountAdapterSelectionState("ready", ["mock"], "mock").valid).toBe(true);
    });
});
