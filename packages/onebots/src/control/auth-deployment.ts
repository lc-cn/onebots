import type { ControlAuth } from "./auth.js";

/** 必须在任何 fork/worker 前调用；立即清除环境，只把一次性闭包交给认证初始化。 */
export function consumeDeploymentBootstrapEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): ((auth: ControlAuth) => void) | undefined {
    let code = environment.ONEBOTS_BOOTSTRAP_CODE;
    delete environment.ONEBOTS_BOOTSTRAP_CODE;
    if (code === undefined) return undefined;
    return auth => {
        const consumed = code;
        code = undefined;
        if (consumed === undefined) throw new Error("控制认证失败");
        auth.installDeploymentBootstrap(consumed);
    };
}
