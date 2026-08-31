export interface AccountProtocolSelectionState {
    valid: boolean;
    title: string;
    description: string;
    actionLabel?: string;
}

export function getAccountProtocolSelectionState(
    protocolKeys: readonly string[],
    enabledProtocols: Readonly<Record<string, boolean>>,
): AccountProtocolSelectionState {
    if (protocolKeys.length === 0) {
        return {
            valid: false,
            title: "无法配置协议出口",
            description: "当前没有已加载的开放协议，请先安装协议并重启 OneBots。",
            actionLabel: "安装开放协议",
        };
    }

    if (!protocolKeys.some(key => enabledProtocols[key])) {
        return {
            valid: false,
            title: "至少启用一个开放协议",
            description: "账号必须有消息出口，请打开下方任一协议后再保存。",
        };
    }

    return {
        valid: true,
        title: "协议出口已配置",
        description: "当前账号已有可用的开放协议出口。",
    };
}
