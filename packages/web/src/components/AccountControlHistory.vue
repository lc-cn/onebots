<script setup lang="ts">
import { computed, toRef } from "vue";
import type { ControlChatMessage } from "@onebots/core/control";
import type { AccountControlConversationItem } from "../account-control-list.js";
import { formatAccountMessageTime } from "../account-control-time.js";
import { useAccountChatViewport } from "../use-account-chat-viewport.js";

const props = defineProps<{
    selected?: AccountControlConversationItem;
    messages: ControlChatMessage[];
    loading: boolean;
    error: string;
    enabled?: boolean;
    hasMore: boolean;
    loadHistory: (older?: boolean) => Promise<"reset" | void>;
}>();
// 时间展示与滚动锚点由记录区共同持有，翻页不会重建发送区或改变草稿。
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const displayMessages = computed(() =>
    props.messages.map(message => ({
        ...message,
        displayTime: formatAccountMessageTime(message.time, timestamp),
    })),
);
const { chatViewport, showJumpLatest, loadOlder, onHistoryScroll, jumpLatest } =
    useAccountChatViewport(toRef(props, "messages"), toRef(props, "selected"), props.loadHistory);

// 头部重试旧页时也必须走同一滚动锚点逻辑。
defineExpose({ loadOlder });
</script>

<template>
    <div class="account-control-history">
        <div
            ref="chatViewport"
            class="account-control-messages"
            role="log"
            tabindex="0"
            aria-label="聊天记录"
            aria-live="polite"
            aria-relevant="additions"
            @scroll.passive="onHistoryScroll">
            <template v-if="selected">
                <button
                    v-if="hasMore && messages.length"
                    type="button"
                    class="account-control-older"
                    :disabled="loading"
                    @click="loadOlder">
                    加载更早消息
                </button>
                <div
                    v-if="loading && !messages.length"
                    class="account-control-skeleton"
                    role="status"
                    aria-label="正在读取聊天记录">
                    <span></span><span></span><span></span>
                </div>
                <p v-if="!messages.length && !loading && !error" class="account-control-hint">
                    {{
                        enabled === false
                            ? "没有已保存的聊天记录；新消息不会保存。"
                            : "还没有聊天记录。"
                    }}
                </p>
                <article
                    v-for="message in displayMessages"
                    :key="message.id"
                    class="account-control-message"
                    :class="message.direction">
                    <div>
                        <span>{{
                            message.direction === "outbound" ? "我" : message.senderName
                        }}</span>
                        <time :datetime="message.displayTime.datetime">{{
                            message.displayTime.label
                        }}</time>
                    </div>
                    <p>{{ message.text }}</p>
                </article>
            </template>
            <p v-else class="account-control-placeholder">从左侧选择好友、群或频道。</p>
        </div>
        <button
            v-if="showJumpLatest"
            type="button"
            class="account-control-jump-latest"
            @click="jumpLatest">
            ↓ 新消息
        </button>
    </div>
</template>
