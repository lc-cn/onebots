import type { ExtensionInfo } from "../types.js";

export interface ExtensionConfigurationAction {
    available: boolean;
    label: string;
    to: {
        path: "/config";
        query: Record<string, string>;
    };
}

export function getExtensionConfigurationAction(
    extension: Pick<ExtensionInfo, "type" | "configurationTarget" | "configurationError">,
): ExtensionConfigurationAction {
    if (extension.configurationError) {
        return {
            available: false,
            label: "配置入口不可用",
            to: { path: "/config", query: {} },
        };
    }
    if (extension.type === "adapter" && extension.configurationTarget.kind === "account") {
        return {
            available: true,
            label: "添加账号",
            to: {
                path: "/config",
                query: { add: extension.configurationTarget.platform },
            },
        };
    }

    if (extension.type === "protocol" && extension.configurationTarget.kind === "protocol") {
        return {
            available: true,
            label: "配置账号出口",
            to: {
                path: "/config",
                query: { protocol: extension.configurationTarget.protocolKey },
            },
        };
    }

    return {
        available: false,
        label: "打开配置",
        to: { path: "/config", query: {} },
    };
}
