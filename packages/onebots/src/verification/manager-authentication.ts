import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ControlAuth } from "../control/auth.js";

/** 使用验证器自己的认证格式创建样本，不能让候选用旧格式自行生成通过样本。 */
export function prepareManagerAuthenticationProbe(workspace: string) {
    const statePath = path.join(workspace, ".control/auth.json");
    if (fs.existsSync(statePath)) throw new Error("认证兼容验证需要独立空白工作区");
    const auth = new ControlAuth({ statePath });
    const first = auth.pair(auth.issueBootstrap());
    const second = auth.pair(auth.issueDevice());
    const bytes = fs.readFileSync(statePath, "utf8");
    const state = JSON.parse(bytes);
    if (state.version !== 2 || state.sessions.length !== 2)
        throw new Error("认证兼容验证样本格式无效");
    const assertPreserved = () => {
        if (fs.readFileSync(statePath, "utf8") !== bytes)
            throw new Error("候选改变了已有设备认证状态");
    };
    return {
        assertPreserved,
        async verify(origin: string): Promise<void> {
            // 两个已有设备都必须可访问，匿名及第三个未授权设备均不可访问。
            for (const [token, expected] of [
                [first, 200],
                [second, 200],
                [undefined, 401],
                [randomBytes(32).toString("base64url"), 401],
            ] as const) {
                const response = await fetch(`${origin}/api/control/status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    signal: AbortSignal.timeout(5000),
                    redirect: "error",
                });
                await response.body?.cancel();
                if (response.status !== expected) throw new Error("候选未通过多设备认证格式验证");
            }
            assertPreserved();
        },
    };
}
