import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { copyDeviceJson, ICQQ_DEVICE_HELPER_SCRIPT } from "./icqq-device-verification.js";

describe("ICQQ 设备验证的 Web 复制内容", () => {
    it("复制可直接解析的完整 JSON，保留空字符串和扩展字段", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const device = { guid: "0011", bssid: "", extra: { count: 2 } };

        await copyDeviceJson(device, { writeText });

        expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(device);
        expect(writeText.mock.calls[0][0]).toBe(JSON.stringify(device, null, 2));
    });

    it("辅助脚本只在 QQ 验证页解析 JSON 并设置 deviceInfo", () => {
        const device = { guid: "0011", bssid: "", extra: { count: 2 } };
        const state = { deviceInfo: { previous: true } };
        const prompt = vi.fn(() => JSON.stringify(device));
        const alert = vi.fn();

        runInNewContext(ICQQ_DEVICE_HELPER_SCRIPT, {
            location: { hostname: "accounts.qq.com", pathname: "/login/attack" },
            window: { __INITIAL_STATE__: state },
            prompt,
            alert,
        });

        expect(state.deviceInfo).toEqual(device);
        expect(prompt).toHaveBeenCalledOnce();
        expect(alert).toHaveBeenCalledWith("设备信息设置成功！");
    });

    it("辅助脚本不执行粘贴内容，也不在非 QQ 页面修改状态", () => {
        const state = { deviceInfo: { previous: true } };
        const alert = vi.fn();
        const malicious = '{"guid":"0011"}; window.__INITIAL_STATE__.deviceInfo = null';
        runInNewContext(ICQQ_DEVICE_HELPER_SCRIPT, {
            location: { hostname: "accounts.qq.com", pathname: "/login/attack" },
            window: { __INITIAL_STATE__: state },
            prompt: () => malicious,
            alert,
        });
        expect(state.deviceInfo).toEqual({ previous: true });
        expect(alert).toHaveBeenCalledWith("设备信息设置失败：请输入有效的设备 JSON。");

        const otherPrompt = vi.fn();
        runInNewContext(ICQQ_DEVICE_HELPER_SCRIPT, {
            location: { hostname: "example.com", pathname: "/login/attack" },
            window: { __INITIAL_STATE__: state },
            prompt: otherPrompt,
            alert,
        });
        expect(otherPrompt).not.toHaveBeenCalled();
        expect(state.deviceInfo).toEqual({ previous: true });
    });
});
