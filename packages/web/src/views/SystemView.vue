<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconTerminal2 } from "@tabler/icons-vue";
import type { ControlClient } from "@onebots/core/control";
import AccessView from "./AccessView.vue";
import NotificationsView from "./NotificationsView.vue";
import ChatHistorySettingsPanel from "../components/ChatHistorySettingsPanel.vue";

const props = defineProps<{
    client: ControlClient;
    token: string;
    active: boolean;
    busy: boolean;
    configurationDirty: boolean;
    accounts: string[];
    runtimeEditorOpen: boolean;
    navigationTarget?: {
        section: "notifications" | "history" | "runtime";
        notificationSection?: "channels" | "history";
        revision: number;
    };
}>();
const emit = defineEmits<{
    logout: [];
    reconnect: [];
    revokedSelf: [];
    notificationsDirtyChange: [dirty: boolean];
    notificationsUpdated: [];
    selectTerminal: [];
    openRuntimeConfiguration: [];
}>();
const section = ref<"access" | "notifications" | "history" | "runtime" | "tools">("access");
const notificationDirty = ref(false);
const historyDirty = ref(false);
const settingsDirty = computed(() => notificationDirty.value || historyDirty.value);
watch(settingsDirty, value => emit("notificationsDirtyChange", value));
watch(
    () => props.navigationTarget?.revision,
    () => {
        if (props.navigationTarget) section.value = props.navigationTarget.section;
    },
);
</script>

<template>
    <section class="workspace-view system-view" aria-labelledby="system-settings-title">
        <header class="page-heading">
            <div>
                <h1 id="system-settings-title">系统</h1>
            </div>
        </header>
        <nav class="system-tabs" aria-label="系统设置">
            <button
                type="button"
                :aria-current="section === 'history' ? 'page' : undefined"
                :class="{ active: section === 'history' }"
                @click="section = 'history'">
                聊天记录
            </button>
            <button
                type="button"
                :aria-current="section === 'access' ? 'page' : undefined"
                :class="{ active: section === 'access' }"
                @click="section = 'access'">
                设备与访问
            </button>
            <button
                type="button"
                :aria-current="section === 'notifications' ? 'page' : undefined"
                :class="{ active: section === 'notifications' }"
                @click="section = 'notifications'">
                通知
            </button>
            <button
                type="button"
                :aria-current="section === 'runtime' ? 'page' : undefined"
                :class="{ active: section === 'runtime' }"
                @click="
                    section = 'runtime';
                    emit('openRuntimeConfiguration');
                ">
                运行设置
            </button>
            <button
                type="button"
                :aria-current="section === 'tools' ? 'page' : undefined"
                :class="{ active: section === 'tools' }"
                @click="section = 'tools'">
                高级工具
            </button>
        </nav>
        <AccessView
            v-show="section === 'access'"
            embedded
            :active="props.active && section === 'access'"
            :client="props.client"
            :busy="props.busy"
            :configuration-dirty="props.configurationDirty"
            @logout="emit('logout')"
            @revoked-self="emit('revokedSelf')"
            @reconnect="emit('reconnect')" />
        <NotificationsView
            v-show="section === 'notifications'"
            embedded
            :token="props.token"
            :active="props.active && section === 'notifications'"
            :accounts="props.accounts"
            :navigation-target="
                props.navigationTarget?.section === 'notifications'
                    ? props.navigationTarget
                    : undefined
            "
            @dirty-change="notificationDirty = $event"
            @updated="emit('notificationsUpdated')" />
        <ChatHistorySettingsPanel
            v-show="section === 'history'"
            :client="client"
            :active="active && section === 'history'"
            @dirty-change="historyDirty = $event" />
        <div v-show="section === 'runtime'" class="system-runtime-settings">
            <div v-if="!runtimeEditorOpen" class="accounts-empty">
                <strong>运行设置</strong>
                <p>服务级参数在这里维护；账号和协议各自在所属页面配置。</p>
                <button
                    type="button"
                    class="system-tool-link"
                    @click="emit('openRuntimeConfiguration')">
                    打开运行设置 →
                </button>
            </div>
            <div id="runtime-configuration-target" class="configuration-owner-target"></div>
        </div>
        <div v-if="section === 'tools'" class="system-tool-list">
            <button type="button" class="system-tool-link" @click="emit('selectTerminal')">
                <IconTerminal2 :size="23" aria-hidden="true" />
                <span><strong>本地终端</strong><small>仅服务所在设备可用</small></span>
                <span aria-hidden="true">→</span>
            </button>
        </div>
    </section>
</template>
