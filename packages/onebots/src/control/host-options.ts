import type { AdmissionLease, WorkspaceBinding } from "../workspace-admission/types.js";
import type { consumeDeploymentAuthenticationEnvironment } from "./auth-deployment.js";
import type { ControlInstallationOptions } from "./installation-service.js";

export interface ControlHostOptions {
    workspace: string;
    /** 由可信 CLI/服务定义显式解析，必须位于工作区之外。 */
    authorityDirectory?: string;
    host?: string;
    port?: number;
    /** 允许通过这些明确的代理 IP 接受 X-Forwarded-Proto: https；默认不信任远程代理。 */
    trustedProxyAddresses?: string[];
    runtimeRoot?: string;
    webRoot?: string;
    gatewayEntrypoint?: string;
    /** 仅由受信 Windows 原生宿主传入；管理进程用它发布只读运行状态。 */
    windowsHostPipe?: string;
    /** 原生宿主预创建的私有反向 HTTP 通道；仅与 windowsHostPipe 配套。 */
    windowsHostRpcPipe?: string;
    installation?: Omit<ControlInstallationOptions, "directory" | "store" | "lifecycle">;
}

export interface AdmittedControlHostInput {
    options: ControlHostOptions;
    workspace: string;
    bundledRuntimeRoot: string;
    windowsNativeMode: boolean;
    filesystemControlSocket: boolean;
    socketPath: string;
    webRoot: string;
    trustedProxyAddresses: string[];
    id: string;
    admission: AdmissionLease;
    binding: WorkspaceBinding;
    installDeploymentAuth: ReturnType<typeof consumeDeploymentAuthenticationEnvironment>;
    release(): void;
}
