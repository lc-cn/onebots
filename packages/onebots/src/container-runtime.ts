/** Docker 的包安装和进程生命周期由宿主协调器负责，不向容器暴露 Docker socket。 */
export function isContainerRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
    return environment.ONEBOTS_CONTAINER === "1";
}
export function assertInProcessPackageMutationAllowed(
    environment: NodeJS.ProcessEnv = process.env,
): void {
    if (environment.ONEBOTS_EXTENSION_MODE === "isolated")
        throw new Error(
            "Docker 扩展使用隔离安装：请在宿主机运行 scripts/docker-extensions.sh install <扩展>，验证后重启容器。下载凭据不要交给运行中的网关。",
        );
}
