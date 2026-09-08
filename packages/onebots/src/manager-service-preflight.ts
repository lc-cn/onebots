import fs from "node:fs";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";

/** 管理服务只预检宿主程序，不读取业务YAML、加载插件或连接账号。 */
export function assertManagerServiceRuntime(spec: ManagerServiceSpec, host: ServiceHost): void {
    try {
        fs.accessSync(spec.nodePath, fs.constants.X_OK);
        fs.accessSync(spec.binPath, fs.constants.R_OK);
        if (!fs.statSync(spec.nodePath).isFile() || !fs.statSync(spec.binPath).isFile())
            throw new Error();
        const version = host.exec(spec.nodePath, ["--version"], { timeoutMs: 5000 }).trim();
        const major = /^v(\d+)\.\d+\.\d+$/.exec(version)?.[1];
        if (!major || Number(major) < 24) throw new Error();
    } catch {
        throw new Error("目标管理程序或 Node.js 运行环境不可用，未改变系统服务状态");
    }
}
