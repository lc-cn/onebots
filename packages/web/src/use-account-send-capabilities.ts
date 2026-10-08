import { computed, ref, type Ref } from "vue";
import type { ControlAccountExploreResult } from "@onebots/core/control";
import {
    accountControlSceneType,
    type AccountControlConversationItem,
} from "./account-control-list.js";

/** 平台能力、会话场景和管理状态共同决定发送入口，未知与不支持不能混为一谈。 */
export function useAccountSendCapabilities(
    selected: Ref<AccountControlConversationItem | undefined>,
    statusError: () => string | undefined,
) {
    const sendScenes = ref<ControlAccountExploreResult["sendScenes"]>();
    const supported = computed(() => {
        const item = selected.value;
        return Boolean(
            item &&
            item.kind !== "guild" &&
            sendScenes.value?.[item.sceneType ?? accountControlSceneType(item.kind)] === true,
        );
    });
    // 状态读取失败不是平台能力缺失，但必须阻止依据过期在线快照发送。
    const canChat = computed(() => supported.value && !statusError());
    const sendCapabilityPending = computed(() => Boolean(selected.value && !sendScenes.value));
    const sendUnsupported = computed(() =>
        Boolean(selected.value && sendScenes.value && !supported.value),
    );

    function applyCapabilities(result: Pick<ControlAccountExploreResult, "sendScenes">) {
        sendScenes.value = result.sendScenes;
    }

    return { sendScenes, canChat, sendCapabilityPending, sendUnsupported, applyCapabilities };
}
