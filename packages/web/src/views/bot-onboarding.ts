export interface BotOnboardingState {
    description: string;
    actionLabel: string;
    route: string;
    actionDisabled: boolean;
}

export type ProtocolInventoryState = "loading" | "available" | "missing" | "unavailable";

export function getBotOnboardingState(
    hasLoadedAdapter: boolean,
    protocolInventory: ProtocolInventoryState,
): BotOnboardingState {
    if (!hasLoadedAdapter) {
        return {
            description: "先比较平台能力，再安装适配器并创建机器人账号。",
            actionLabel: "安装平台适配器",
            route: "/extensions?type=adapter",
            actionDisabled: false,
        };
    }
    if (protocolInventory === "loading") {
        return {
            description: "适配器已经加载，正在确认可用的开放协议。",
            actionLabel: "正在检查协议",
            route: "/extensions?type=protocol",
            actionDisabled: true,
        };
    }
    if (protocolInventory === "missing") {
        return {
            description: "适配器已经加载；请先安装至少一个开放协议，再创建机器人账号。",
            actionLabel: "安装开放协议",
            route: "/extensions?type=protocol",
            actionDisabled: false,
        };
    }
    if (protocolInventory === "unavailable") {
        return {
            description: "无法确认开放协议是否已加载，请先检查功能扩展。",
            actionLabel: "检查功能扩展",
            route: "/extensions?type=protocol",
            actionDisabled: false,
        };
    }
    return {
        description: "适配器与开放协议已经加载，可以继续创建机器人账号。",
        actionLabel: "添加机器人账号",
        route: "/config?add=",
        actionDisabled: false,
    };
}

export function isAccountWizardRequest(
    requestedPlatform: unknown,
    availablePlatforms: readonly string[],
): requestedPlatform is string {
    return (
        typeof requestedPlatform === "string" &&
        (requestedPlatform === "" || availablePlatforms.includes(requestedPlatform))
    );
}
