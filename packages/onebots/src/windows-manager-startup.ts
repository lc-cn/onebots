/** 沿用既有 native pipe 建立后的启动发布窗口；不是业务操作重试。 */
export async function publishWindowsManagerStartup(publish: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            await publish();
            return;
        } catch {
            if (attempt === 49) throw new Error("Windows 原生宿主状态发布失败");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}
