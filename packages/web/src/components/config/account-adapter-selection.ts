export type SchemaLoadStatus = "loading" | "ready" | "error";

export interface AccountAdapterSelectionState {
    valid: boolean;
    variant: "info" | "warning";
    title: string;
    description: string;
    action?: "retry" | "install";
    actionLabel?: string;
}

export function getAccountAdapterSelectionState(
    schemaStatus: SchemaLoadStatus,
    availablePlatforms: readonly string[],
    selectedPlatform: string,
): AccountAdapterSelectionState {
    if (schemaStatus === "loading") {
        return {
            valid: false,
            variant: "info",
            title: "正在确认可用平台",
            description: "正在读取已加载适配器的配置能力，请稍候。",
        };
    }

    if (schemaStatus === "error") {
        return {
            valid: false,
            variant: "warning",
            title: "无法确认可用平台",
            description: "配置能力加载失败，请重新读取后再创建账号。",
            action: "retry",
            actionLabel: "重新读取",
        };
    }

    if (availablePlatforms.length === 0) {
        return {
            valid: false,
            variant: "warning",
            title: "尚未加载平台适配器",
            description: "请先安装并重启至少一个平台适配器，再创建机器人账号。",
            action: "install",
            actionLabel: "安装平台适配器",
        };
    }

    if (selectedPlatform && !availablePlatforms.includes(selectedPlatform)) {
        return {
            valid: false,
            variant: "warning",
            title: "账号对应的适配器未加载",
            description: `当前进程没有加载 ${selectedPlatform} 适配器，无法安全编辑这个账号。`,
            action: "install",
            actionLabel: "检查平台适配器",
        };
    }

    return {
        valid: true,
        variant: "info",
        title: "平台适配器可用",
        description: "可以继续填写账号信息。",
    };
}
