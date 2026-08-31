import type { ExtensionInfo } from "../types.js";

export interface ExtensionConfigurationAction {
    label: string;
    to: {
        path: "/config";
        query: Record<string, string>;
    };
}

export function getExtensionConfigurationAction(
    extension: Pick<ExtensionInfo, "type" | "configurationTarget">,
): ExtensionConfigurationAction {
    if (extension.type === "adapter" && extension.configurationTarget.kind === "account") {
        return {
            label: "添加账号",
            to: {
                path: "/config",
                query: { add: extension.configurationTarget.platform },
            },
        };
    }

    if (extension.type === "protocol" && extension.configurationTarget.kind === "protocol") {
        return {
            label: "配置账号出口",
            to: {
                path: "/config",
                query: { protocol: extension.configurationTarget.protocolKey },
            },
        };
    }

    return {
        label: "打开配置",
        to: { path: "/config", query: {} },
    };
}
