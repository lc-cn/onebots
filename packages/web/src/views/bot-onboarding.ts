export interface BotOnboardingState {
    description: string;
    actionLabel: string;
    route: string;
}

export function getBotOnboardingState(hasLoadedAdapter: boolean): BotOnboardingState {
    return hasLoadedAdapter
        ? {
              description: "适配器已经加载，可以继续创建机器人账号。",
              actionLabel: "添加机器人账号",
              route: "/config?add=",
          }
        : {
              description: "先比较平台能力，再安装适配器并创建机器人账号。",
              actionLabel: "安装平台适配器",
              route: "/extensions",
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
