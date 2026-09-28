<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { IconBell, IconRefresh } from "@tabler/icons-vue";
import {
    type NotificationConfig,
    type NotificationDelivery,
    type NotificationSnapshot,
} from "../notification-model.js";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";
import NotificationChannelsPanel from "../components/NotificationChannelsPanel.vue";
import NotificationRulesPanel from "../components/NotificationRulesPanel.vue";

const props = defineProps<{
    token: string;
    active: boolean;
    accounts: string[];
    embedded?: boolean;
    navigationTarget?: { notificationSection?: "channels" | "history"; revision: number };
}>();
const emit = defineEmits<{ dirtyChange: [dirty: boolean]; updated: [] }>();
const config = ref<NotificationConfig>();
const deliveries = ref<NotificationDelivery[]>([]);
const droppedDeliveries = ref(0);
const section = ref<"channels" | "rules" | "history">("channels");
const busy = ref(false);
const dirty = ref(false);
const error = ref("");
const notice = ref("");

async function request<T>(path: string, method: "GET" | "POST" = "GET", body?: object): Promise<T> {
    const response = await fetch(path, {
        method,
        headers: {
            authorization: `Bearer ${props.token}`,
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
        const message =
            result && typeof result === "object" && "message" in result
                ? String(result.message)
                : `请求失败（HTTP ${response.status}）`;
        throw new Error(message);
    }
    return result as T;
}

async function load() {
    if (!props.token || (dirty.value && !window.confirm("通知配置尚未保存，确定丢弃修改并刷新？")))
        return;
    busy.value = true;
    error.value = "";
    try {
        const snapshot = await request<NotificationSnapshot>("/api/control/notifications");
        config.value = snapshot.config;
        deliveries.value = snapshot.deliveries;
        droppedDeliveries.value = snapshot.droppedDeliveries;
        await nextTick();
        setDirty(false);
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "通知配置加载失败";
    } finally {
        busy.value = false;
    }
}

function setDirty(value: boolean) {
    dirty.value = value;
    emit("dirtyChange", value);
}
watch(
    config,
    () => {
        if (config.value) setDirty(true);
    },
    { deep: true },
);
watch(
    () => props.active,
    value => {
        if (value && !config.value) void load();
    },
    { immediate: true },
);
watch(
    () => props.navigationTarget?.revision,
    () => {
        if (props.navigationTarget?.notificationSection)
            section.value = props.navigationTarget.notificationSection;
    },
);

async function save() {
    if (!config.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const result = await request<{ config: NotificationConfig }>(
            "/api/control/notifications/config",
            "POST",
            config.value,
        );
        config.value = result.config;
        await nextTick();
        setDirty(false);
        notice.value = "通知配置已保存并生效。";
        emit("updated");
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "通知配置保存失败";
    } finally {
        busy.value = false;
    }
}

async function test(id: string) {
    busy.value = true;
    error.value = "";
    try {
        await request(`/api/control/notifications/channels/${id}/test`, "POST", {});
        notice.value = "测试通知已发送。";
        emit("updated");
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "测试通知失败";
    } finally {
        busy.value = false;
    }
}

async function retry(id: string) {
    busy.value = true;
    error.value = "";
    try {
        await request(`/api/control/notifications/deliveries/${id}/retry`, "POST", {});
        await fetchDeliveries();
        notice.value = "已重新排队。";
        emit("updated");
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "重试失败";
    } finally {
        busy.value = false;
    }
}

// 投递记录可独立刷新，不应覆盖用户正在编辑的通知配置草稿。
async function fetchDeliveries() {
    const snapshot = await request<NotificationSnapshot>("/api/control/notifications");
    deliveries.value = snapshot.deliveries;
    droppedDeliveries.value = snapshot.droppedDeliveries;
}

async function refreshDeliveries() {
    busy.value = true;
    error.value = "";
    try {
        await fetchDeliveries();
        emit("updated");
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "投递记录刷新失败";
    } finally {
        busy.value = false;
    }
}

function channelName(id: string) {
    return config.value?.channels.find(item => item.id === id)?.name ?? "已删除渠道";
}
</script>

<template>
    <section
        class="notifications-view"
        :class="{ 'workspace-view': !embedded }"
        aria-labelledby="notifications-title">
        <h2 v-if="embedded" id="notifications-title" class="sr-only">通知与告警</h2>
        <header v-else class="page-heading">
            <div>
                <h1 id="notifications-title"><IconBell :size="25" /> 通知与告警</h1>
                <UiInfoTip
                    label="通知设置说明"
                    text="先添加投递渠道，再用事件规则选择通知范围；投递结果可在记录中查看。" />
            </div>
        </header>
        <div class="workspace-action-bar notification-actions" role="toolbar" aria-label="通知操作">
            <span class="workspace-action-context">
                {{ dirty ? "有未保存的修改" : "通知与告警" }}
                <UiInfoTip
                    v-if="embedded"
                    label="通知设置说明"
                    text="先添加投递渠道，再用事件规则选择通知范围；投递结果可在记录中查看。" />
            </span>
            <UiButton
                class="workspace-action-refresh"
                aria-label="刷新通知配置"
                variant="ghost"
                :disabled="busy"
                @click="load"
                ><IconRefresh :size="16" aria-hidden="true" /><span>刷新</span></UiButton
            >
            <UiButton variant="primary" :disabled="!dirty || busy" :loading="busy" @click="save"
                >保存配置</UiButton
            >
        </div>
        <p v-if="error" class="notification-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="notification-notice" role="status">{{ notice }}</p>
        <p v-if="!config && !busy">通知配置暂不可用。</p>
        <template v-if="config">
            <div class="notification-section-picker">
                <label for="notification-section">查看</label>
                <select id="notification-section" v-model="section">
                    <option value="channels">渠道</option>
                    <option value="rules">事件规则</option>
                    <option value="history">投递记录</option>
                </select>
            </div>

            <NotificationChannelsPanel
                v-if="section === 'channels'"
                :config="config"
                :busy="busy"
                :dirty="dirty"
                @test="test" />
            <NotificationRulesPanel
                v-else-if="section === 'rules'"
                :config="config"
                :accounts="accounts" />

            <div v-else class="notification-stack">
                <div class="notification-row">
                    <p class="notification-help">
                        显示最近 200 条投递；失败后自动退避重试，也可手动重试。
                    </p>
                    <UiButton variant="ghost" :disabled="busy" @click="refreshDeliveries"
                        >刷新记录</UiButton
                    >
                </div>
                <p v-if="!deliveries.length" class="notification-help">暂无投递记录。</p>
                <p v-if="droppedDeliveries" class="notification-error" role="alert">
                    投递队列曾达到容量上限，{{ droppedDeliveries }}
                    条通知未能排队。请检查渠道故障与积压。
                </p>
                <article
                    v-for="delivery in deliveries"
                    :key="delivery.id"
                    class="notification-card notification-delivery">
                    <div class="notification-row">
                        <strong>{{ delivery.events[0]?.title ?? "通知" }}</strong
                        ><span>{{
                            delivery.status === "delivered"
                                ? "已投递"
                                : delivery.status === "failed"
                                  ? "失败"
                                  : "待投递"
                        }}</span>
                    </div>
                    <p>
                        {{ channelName(delivery.channelId) }} ·
                        {{ new Date(delivery.createdAt).toLocaleString() }} ·
                        {{ delivery.events.length }} 个事件 · 尝试 {{ delivery.attempts }} 次
                    </p>
                    <p v-if="delivery.lastError">{{ delivery.lastError }}</p>
                    <UiButton
                        v-if="
                            delivery.status !== 'delivered' &&
                            !(
                                delivery.events[0]?.type === 'login.interaction' &&
                                Date.now() - Date.parse(delivery.createdAt) > 30 * 60 * 1000
                            )
                        "
                        variant="ghost"
                        :disabled="busy"
                        @click="retry(delivery.id)"
                        >手动重试</UiButton
                    >
                </article>
            </div>
        </template>
    </section>
</template>
