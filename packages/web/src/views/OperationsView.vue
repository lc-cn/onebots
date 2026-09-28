<script setup lang="ts">
import { ref, watch } from "vue";
import type { ControlClient } from "@onebots/core/control";
import { IconMessages, IconTerminal2 } from "@tabler/icons-vue";
import ControlLogsPanel from "../components/ControlLogsPanel.vue";
import ControlMessageDebugPanel from "../components/ControlMessageDebugPanel.vue";

const props = defineProps<{
    client: ControlClient;
    gatewayInstanceId?: string;
    active: boolean;
}>();
type OperationsTab = "messages" | "logs";
const selectedTab = ref<OperationsTab>("logs");
const tabs = [
    {
        id: "messages" as const,
        label: "消息调试",
        description: "确认消息是否走完整条链路",
        icon: IconMessages,
    },
    {
        id: "logs" as const,
        label: "运行日志",
        description: "定位管理服务和网关错误",
        icon: IconTerminal2,
    },
];

function selectTab(tab: OperationsTab) {
    selectedTab.value = tab;
}

watch(
    () => props.active,
    active => {
        if (active) selectedTab.value = "logs";
    },
);

function navigateTabs(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next].id);
    const list = (event.currentTarget as HTMLElement).parentElement;
    list?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
}
</script>

<template>
    <section class="workspace-view operations-view" aria-labelledby="activity-title">
        <header class="page-heading">
            <div>
                <h1 id="activity-title">日志 / 调试</h1>
            </div>
        </header>

        <nav class="operations-tabs" role="tablist" aria-label="日志与调试">
            <button
                v-for="(tab, index) in tabs"
                :id="`operations-tab-${tab.id}`"
                :key="tab.id"
                type="button"
                role="tab"
                :aria-selected="selectedTab === tab.id"
                :aria-controls="`operations-panel-${tab.id}`"
                :tabindex="selectedTab === tab.id ? 0 : -1"
                @click="selectTab(tab.id)"
                @keydown="navigateTabs($event, index)">
                <component :is="tab.icon" :size="20" aria-hidden="true" />
                <span
                    ><strong>{{ tab.label }}</strong
                    ><small>{{ tab.description }}</small></span
                >
            </button>
        </nav>

        <div
            v-show="selectedTab === 'messages'"
            id="operations-panel-messages"
            class="operations-tab-panel"
            role="tabpanel"
            aria-labelledby="operations-tab-messages">
            <ControlMessageDebugPanel
                :client="client"
                :gateway-instance-id="gatewayInstanceId"
                :active="active && selectedTab === 'messages'" />
        </div>
        <div
            v-show="selectedTab === 'logs'"
            id="operations-panel-logs"
            class="operations-tab-panel"
            role="tabpanel"
            aria-labelledby="operations-tab-logs">
            <ControlLogsPanel :client="client" :active="active && selectedTab === 'logs'" />
        </div>
    </section>
</template>

<style scoped>
.operations-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
    margin-bottom: 1rem;
    padding: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface-raised);
}
.operations-tabs button {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.7rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid transparent;
    border-radius: calc(var(--radius-panel) - 0.25rem);
    background: transparent;
    color: var(--fg-secondary);
    text-align: left;
    transition:
        background 180ms ease,
        border-color 180ms ease,
        color 180ms ease,
        transform 160ms ease;
}
.operations-tabs button:hover {
    color: var(--fg);
    background: var(--surface);
}
.operations-tabs button:active {
    transform: scale(0.985);
}
.operations-tabs button[aria-selected="true"] {
    border-color: var(--border-strong);
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--shadow);
}
.operations-tabs button > span {
    display: grid;
    min-width: 0;
}
.operations-tabs strong {
    font-weight: 650;
}
.operations-tabs small {
    overflow: hidden;
    color: var(--fg-tertiary);
    font-size: 0.75rem;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.operations-tab-panel {
    display: grid;
    gap: 1rem;
}
@media (max-width: 760px) {
    .operations-tabs {
        grid-template-columns: 1fr;
    }
    .operations-tabs small {
        white-space: normal;
    }
}
</style>
