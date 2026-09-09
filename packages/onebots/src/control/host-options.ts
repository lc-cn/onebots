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
    installation?: Omit<ControlInstallationOptions, "directory" | "store" | "lifecycle">;
}
