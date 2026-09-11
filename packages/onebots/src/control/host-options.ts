import type { ControlInstallationOptions } from "./installation-service.js";

export interface ControlHostOptions {
    workspace: string;
    host?: string;
    port?: number;
    runtimeRoot?: string;
    webRoot?: string;
    gatewayEntrypoint?: string;
    /** 仅由受信 Windows 原生宿主传入；管理进程用它发布只读运行状态。 */
    windowsHostPipe?: string;
    /** 原生宿主预创建的私有反向 HTTP 通道；仅与 windowsHostPipe 配套。 */
    windowsHostRpcPipe?: string;
    installation?: Omit<ControlInstallationOptions, "directory" | "store" | "lifecycle">;
}
