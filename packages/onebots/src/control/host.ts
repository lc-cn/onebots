import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import packageMetadata from "../../package.json" with { type: "json" };
import { consumeDeploymentAuthenticationEnvironment } from "./auth-deployment.js";
import {
    acquireControlWorkspace,
    controlDirectory,
    controlSocket,
    supportsFilesystemControlSocket,
} from "./workspace.js";
import { WINDOWS_HOST_PIPE_NAME } from "../service-platform-windows.js";
import { trustedControlProxyAddresses } from "./credential-transport.js";
import { acquireWorkspaceAdmission } from "../workspace-admission/admission.js";
import { startAdmissionRejectedHost } from "./admission-host.js";
import { createDefaultServiceHost } from "../service-host.js";
import { createWindowsPrivateDirectory } from "../windows-private-file.js";
import type { ControlHostOptions } from "./host-options.js";
export type { ControlHostOptions } from "./host-options.js";
export const WORKSPACE_ADMISSION_CAPABILITY = 1;
export async function startControlHost(options: ControlHostOptions) {
    const trustedProxyAddresses = trustedControlProxyAddresses(options.trustedProxyAddresses);
    if (
        options.windowsHostPipe &&
        (process.platform !== "win32" || options.windowsHostPipe !== WINDOWS_HOST_PIPE_NAME)
    )
        throw new Error("Windows 原生宿主管道无效");
    if (
        (options.windowsHostRpcPipe !== undefined) !== (options.windowsHostPipe !== undefined) ||
        (options.windowsHostRpcPipe !== undefined &&
            !/^\\\\\.\\pipe\\onebots-manager-rpc-[0-9a-f]{32}$/.test(options.windowsHostRpcPipe))
    )
        throw new Error("Windows 原生宿主 RPC 管道无效");
    // 立即从环境清除一次性秘密；只有来源通过后才对认证 Module 应用捕获的输入。
    const installDeploymentAuth = consumeDeploymentAuthenticationEnvironment();
    fs.mkdirSync(options.workspace, { recursive: true });
    const workspace = fs.realpathSync(options.workspace);
    const bundledRuntimeRoot = options.runtimeRoot ?? path.resolve(import.meta.dirname, "../..");
    const windowsNativeMode = options.windowsHostPipe !== undefined;
    const filesystemControlSocket = supportsFilesystemControlSocket();
    // Windows foreground/candidate verification has no Unix socket. Production Windows service
    // supplies windowsHostPipe and is additionally bound to the native Job Object/status channel.
    const socketPath =
        options.windowsHostPipe ?? (filesystemControlSocket ? controlSocket(workspace) : "");
    const webRoot =
        options.webRoot ??
        path.join(
            path.dirname(createRequire(import.meta.url).resolve("@onebots/web/package.json")),
            "dist",
        );
    const freshWorkspace = !fs.existsSync(controlDirectory(workspace));
    if (process.platform === "win32" && freshWorkspace)
        createWindowsPrivateDirectory(controlDirectory(workspace));
    const releaseWorkspace = acquireControlWorkspace(
        workspace,
        process.platform === "win32" ? createDefaultServiceHost() : undefined,
    );
    const admission = acquireWorkspaceAdmission(workspace, options.authorityDirectory);
    const id = randomUUID();
    if (admission.inspection.state !== "verified" || !admission.binding)
        return startAdmissionRejectedHost({
            options,
            inspection: admission.inspection,
            manager: { id, version: packageMetadata.version, pid: process.pid },
            socketPath,
            webRoot,
            release: releaseWorkspace,
        });
    const release = () => {
        try {
            admission.release();
        } finally {
            releaseWorkspace();
        }
    };
    // 来源拒绝路径甚至不加载业务构造器模块。
    const { startAdmittedControlHost } = await import("./host-admitted.js").catch(error => {
        release();
        throw error;
    });
    return startAdmittedControlHost({
        options,
        workspace,
        bundledRuntimeRoot,
        windowsNativeMode,
        filesystemControlSocket,
        socketPath,
        webRoot,
        trustedProxyAddresses,
        id,
        admission,
        binding: admission.binding,
        installDeploymentAuth,
        release,
    });
}
