import type { ControlAuth } from "./auth.js";

/** 必须在任何 fork/worker 前调用；两个秘密立即清除，初始化闭包只可调用一次。 */
export function consumeDeploymentAuthenticationEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): ((auth: ControlAuth) => void) | undefined {
    let bootstrap = environment.ONEBOTS_BOOTSTRAP_CODE;
    let recovery = environment.ONEBOTS_RECOVERY_CODE;
    delete environment.ONEBOTS_BOOTSTRAP_CODE;
    delete environment.ONEBOTS_RECOVERY_CODE;
    if (bootstrap === undefined && recovery === undefined) return undefined;
    return auth => {
        const initial = bootstrap;
        const restore = recovery;
        bootstrap = undefined;
        recovery = undefined;
        // 两个入口不能隐式择一，否则遗留的部署 Secret 会改变用户的授权意图。
        if ((initial === undefined) === (restore === undefined)) throw new Error("控制认证失败");
        if (restore !== undefined) auth.installDeploymentRecovery(restore);
        else auth.installDeploymentBootstrap(initial!);
    };
}
