<script setup lang="ts">
import { computed, onUnmounted, reactive, watch } from "vue";
import { IconRefresh, IconTerminal2 } from "@tabler/icons-vue";
import type { ControlClient, ControlLogSource } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import { LogController, logView } from "./control-logs-state";

const props = defineProps<{ client: ControlClient; active: boolean }>();
const view = reactive(logView());
const controller = new LogController(props.client, view);
const tabs: Array<{ source: ControlLogSource; label: string; description: string }> = [
    { source: "gateway", label: "网关", description: "平台与协议运行输出" },
    { source: "manager", label: "管理服务", description: "控制平面与生命周期输出" },
    { source: "operation", label: "控制操作", description: "安装、配置与启停记录" },
];
const current = computed(() => view.sources[view.source]);
const currentTab = computed(() => tabs.find(tab => tab.source === view.source) ?? tabs[0]);
const statusLabel = computed(() => {
    if (!props.active || current.value.status === "paused") return "已暂停";
    if (current.value.status === "connecting") return "连接中";
    if (current.value.status === "live") return "实时";
    return "连接中断";
});

watch(
    () => props.client,
    client => controller.setClient(client),
    { flush: "sync" },
);
watch(
    () => props.active,
    active => controller.setActive(active),
    {
        immediate: true,
        flush: "sync",
    },
);
onUnmounted(() => controller.dispose());

function selectTab(source: ControlLogSource): void {
    controller.setSource(source);
}

function navigateTabs(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].source);
    const list = (event.currentTarget as HTMLElement).parentElement;
    list?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
}
</script>

<template>
    <section class="live-logs-panel" aria-labelledby="service-logs-title">
        <header class="live-logs-header">
            <div>
                <p class="diagnostic-panel-kicker">实时输出</p>
                <h2 id="service-logs-title"><IconTerminal2 :size="19" />服务日志</h2>
                <p>进入页面即连接当前日志源，切换标签或离开页面时连接会自动关闭。</p>
            </div>
            <span class="log-stream-status" :class="current.status" role="status">
                <i aria-hidden="true"></i>{{ statusLabel }}
            </span>
        </header>

        <div class="log-tabs" role="tablist" aria-label="服务日志来源">
            <button
                v-for="(tab, index) in tabs"
                :id="`log-tab-${tab.source}`"
                :key="tab.source"
                type="button"
                role="tab"
                :aria-selected="view.source === tab.source"
                :aria-controls="`log-panel-${tab.source}`"
                :tabindex="view.source === tab.source ? 0 : -1"
                @click="selectTab(tab.source)"
                @keydown="navigateTabs($event, index)">
                <span>{{ tab.label }}</span>
                <small>{{ tab.description }}</small>
            </button>
        </div>

        <div
            :id="`log-panel-${view.source}`"
            class="log-console"
            role="tabpanel"
            :aria-labelledby="`log-tab-${view.source}`">
            <div class="log-console-meta">
                <span>{{ currentTab.label }}日志</span>
                <span>最多保留最近 256 KiB</span>
            </div>
            <p v-if="current.error" class="log-stream-error" role="alert">
                {{ current.error }}
                <UiButton @click="controller.retry()"><IconRefresh :size="15" />重新连接</UiButton>
            </p>
            <p v-else-if="current.status === 'connecting' && !current.snapshot" role="status">
                正在建立安全连接…
            </p>
            <p v-else-if="current.snapshot && !current.snapshot.exists">当前来源尚未生成日志。</p>
            <p v-else-if="current.snapshot && !current.snapshot.text">已连接，等待新的日志输出。</p>
            <pre v-if="current.snapshot?.text" :aria-label="`${currentTab.label}日志内容`">{{
                current.snapshot.text
            }}</pre>
        </div>
        <p class="log-safety-note">日志可能包含平台凭据和消息内容，分享前请先检查并脱敏。</p>
    </section>
</template>
