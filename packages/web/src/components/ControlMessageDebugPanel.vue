<script setup lang="ts">
import { computed, onUnmounted, shallowReactive, ref, watch } from "vue";
import type { ControlClient } from "@onebots/core/control";
import { IconMessages } from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";
import { MessageDebugController, messageDebugView } from "./control-message-debug-state";

const props = defineProps<{ client: ControlClient; gatewayInstanceId?: string; active: boolean }>();
// 快照整体替换；不递归代理任意深度的 JSON 消息。
const view = shallowReactive(messageDebugView());
const controller = new MessageDebugController(props.client, view);
const direction = ref("");
const platform = ref("");
const account = ref("");
const protocol = ref("");
const entries = computed(() =>
    view.entries.filter(
        entry =>
            (!direction.value || entry.direction === direction.value) &&
            (!platform.value || entry.platform.includes(platform.value)) &&
            (!account.value || entry.account_id.includes(account.value)) &&
            (!protocol.value ||
                `${entry.protocol ?? ""}/${entry.version ?? ""}`.includes(protocol.value)),
    ),
);
watch(
    [() => props.active, () => props.gatewayInstanceId],
    ([active, instanceId]) => {
        controller.setGateway(instanceId);
        controller.setActive(active);
    },
    { immediate: true },
);
onUnmounted(() => controller.dispose());
</script>

<template>
    <section
        class="message-debug-panel border border-border rounded-panel p-6 bg-surface space-y-4">
        <header class="diagnostic-panel-header">
            <div>
                <p class="diagnostic-panel-kicker">消息链路</p>
                <h2 class="text-lg font-medium">
                    <IconMessages :size="22" aria-hidden="true" />消息调试
                </h2>
            </div>
            <p>按需读取当前网关最近 300 条双向消息，并按平台、账号或协议定位链路问题。</p>
        </header>
        <div class="diagnostic-toolbar">
            <UiButton
                :disabled="!gatewayInstanceId || view.loading || view.clearing"
                @click="controller.refresh()"
                >刷新</UiButton
            >
            <UiButton
                :disabled="!view.available || view.loading || view.clearing"
                @click="controller.clear()"
                >清空历史</UiButton
            >
            <UiButton
                :disabled="!gatewayInstanceId"
                @click="controller.setAutomatic(!view.automatic)">
                {{ view.automatic ? "暂停自动刷新" : "开启自动刷新" }}
            </UiButton>
            <span v-if="view.automatic" class="text-sm text-fg-secondary"
                >每次读取完成后等待 1 秒</span
            >
        </div>
        <p v-if="!gatewayInstanceId" role="status" class="text-sm text-fg-secondary">
            网关未运行，消息历史不可用。
        </p>
        <p v-if="view.error" role="alert" class="text-sm text-danger">{{ view.error }}</p>
        <p v-if="view.loading || view.clearing" role="status" class="text-sm text-fg-secondary">
            {{ view.clearing ? "正在清空…" : "正在读取…" }}
        </p>
        <div class="message-filter-grid">
            <label
                >方向
                <select
                    v-model="direction"
                    class="w-full rounded-control border border-border bg-surface p-2">
                    <option value="">全部</option>
                    <option value="inbound">平台入站</option>
                    <option value="outbound">协议出站</option>
                </select>
            </label>
            <label
                >平台<input
                    v-model="platform"
                    class="w-full rounded-control border border-border bg-surface p-2"
                    placeholder="筛选平台"
            /></label>
            <label
                >账号<input
                    v-model="account"
                    class="w-full rounded-control border border-border bg-surface p-2"
                    placeholder="筛选账号"
            /></label>
            <label
                >协议<input
                    v-model="protocol"
                    class="w-full rounded-control border border-border bg-surface p-2"
                    placeholder="筛选协议或版本"
            /></label>
        </div>
        <p v-if="view.instanceId" class="text-xs text-fg-muted break-all">
            网关实例：{{ view.instanceId }}
        </p>
        <p v-if="view.available && !entries.length" class="text-sm text-fg-secondary">
            没有符合筛选条件的消息。
        </p>
        <p v-if="!view.available && entries.length" class="text-sm text-danger">
            以下是未核验的旧记录，不代表当前网关历史。
        </p>
        <div class="space-y-2 max-h-[36rem] overflow-auto">
            <details
                v-for="entry in entries"
                :key="`${view.instanceId}:${entry.seq}`"
                class="border border-border rounded-control p-3">
                <summary class="cursor-pointer text-sm break-all">
                    #{{ entry.seq }} · {{ new Date(entry.time).toLocaleTimeString() }} ·
                    {{ entry.direction === "inbound" ? "平台入站" : "协议出站" }} ·
                    {{ entry.platform }}/{{ entry.account_id }}
                    <span v-if="entry.protocol"> · {{ entry.protocol }}/{{ entry.version }}</span>
                </summary>
                <pre class="mt-3 whitespace-pre-wrap break-all text-xs">{{
                    JSON.stringify(entry.payload, null, 2)
                }}</pre>
            </details>
        </div>
    </section>
</template>
