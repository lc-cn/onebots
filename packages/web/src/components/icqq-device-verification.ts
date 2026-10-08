/** 此代码由用户在 QQ 身份验证页的控制台手动运行，不包含设备数据。 */
export const ICQQ_DEVICE_HELPER_SCRIPT = `(() => {
    "use strict";
    if (location.hostname !== "accounts.qq.com" || location.pathname !== "/login/attack") {
        alert("请先打开 ICQQ 提供的 QQ 身份验证链接，在发送验证码页面运行此脚本。");
        return;
    }
    const input = prompt("请粘贴从 OneBots 复制的完整设备 JSON");
    if (input === null) return;
    try {
        const device = JSON.parse(input);
        if (!device || typeof device !== "object" || Array.isArray(device) ||
            typeof device.guid !== "string" || !device.guid ||
            !window.__INITIAL_STATE__ || typeof window.__INITIAL_STATE__ !== "object") {
            throw new Error("invalid device");
        }
        window.__INITIAL_STATE__.deviceInfo = device;
        alert("设备信息设置成功！");
    } catch {
        alert("设备信息设置失败：请输入有效的设备 JSON。");
    }
})();`;

export const formatDeviceJson = (device: Record<string, unknown>): string =>
    JSON.stringify(device, null, 2);

export async function copyDeviceJson(
    device: Record<string, unknown>,
    clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
): Promise<void> {
    await clipboard.writeText(formatDeviceJson(device));
}
