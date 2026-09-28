<script setup lang="ts">
import { ref, watch } from "vue";
import type { ControlChatHistorySettings, ControlClient } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{ client: ControlClient; active: boolean }>();
const emit = defineEmits<{ dirtyChange: [dirty: boolean] }>();
const settings = ref<ControlChatHistorySettings>();
const draft = ref<ControlChatHistorySettings>({ enabled: true, retentionDays: 30 });
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const dirty = ref(false);

async function load() {
    if (loading.value || saving.value) return;
    loading.value = true;
    error.value = "";
    try {
        const value = await props.client.chatHistorySettings();
        settings.value = value;
        draft.value = { ...value };
        dirty.value = false;
        emit("dirtyChange", false);
    } catch {
        error.value = "无法读取聊天记录设置，请稍后重试。";
    } finally {
        loading.value = false;
    }
}
function markDirty() {
    dirty.value = true;
    emit("dirtyChange", true);
}
async function save() {
    if (
        !Number.isInteger(draft.value.retentionDays) ||
        draft.value.retentionDays < 1 ||
        draft.value.retentionDays > 3650
    ) {
        error.value = "保留时间需为 1–3650 天。";
        return;
    }
    saving.value = true;
    error.value = "";
    notice.value = "";
    try {
        const value = await props.client.updateChatHistorySettings(draft.value);
        settings.value = value;
        draft.value = { ...value };
        dirty.value = false;
        emit("dirtyChange", false);
        notice.value = "聊天记录设置已保存。";
    } catch {
        error.value = "保存失败，请检查管理服务后重试。";
    } finally {
        saving.value = false;
    }
}
async function clear() {
    if (!window.confirm("确定永久清除 OneBots 保存的全部账号聊天记录吗？此操作不可撤销。")) return;
    saving.value = true;
    error.value = "";
    notice.value = "";
    try {
        const result = await props.client.clearChatHistory();
        notice.value = `已清除 ${result.deleted} 条聊天记录。`;
    } catch {
        error.value = "清理结果暂不可确认，请刷新页面核对。";
    } finally {
        saving.value = false;
    }
}
watch(
    () => props.active,
    active => {
        if (active && !settings.value) void load();
    },
    { immediate: true },
);
</script>

<template>
    <section class="system-history-settings" aria-labelledby="history-settings-title">
        <header class="page-heading">
            <div>
                <h2 id="history-settings-title">聊天记录</h2>
                <p>仅保存规范化消息文本与会话索引，不保存平台原始事件或附件内容。</p>
            </div>
            <UiButton :disabled="loading || saving" @click="load">刷新</UiButton>
        </header>
        <p v-if="error" role="alert" class="accounts-warning">{{ error }}</p>
        <p v-if="notice" role="status" class="accounts-local-note">{{ notice }}</p>
        <p v-if="loading" role="status" class="accounts-local-note">正在读取设置…</p>
        <form v-if="settings" class="system-history-form" @submit.prevent="save">
            <label class="system-history-toggle"
                ><input v-model="draft.enabled" type="checkbox" @change="markDirty" />
                <span
                    ><strong>保存收发聊天记录</strong
                    ><small>关闭后不再记录新消息，已有记录保留至到期或手动清理。</small></span
                ></label
            >
            <label class="system-history-retention"
                >保留天数
                <input
                    v-model.number="draft.retentionDays"
                    type="number"
                    min="1"
                    max="3650"
                    step="1"
                    @input="markDirty"
            /></label>
            <p class="accounts-local-note">
                默认 30 天；过期记录自动清理。更改后对现有记录同样生效。
            </p>
            <div class="system-history-actions">
                <UiButton
                    type="submit"
                    variant="primary"
                    :disabled="!dirty || saving"
                    :loading="saving"
                    >保存设置</UiButton
                >
                <UiButton variant="danger" :disabled="saving" @click="clear"
                    >清除全部聊天记录</UiButton
                >
            </div>
        </form>
    </section>
</template>
