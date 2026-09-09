<script setup lang="ts">
import { onUnmounted, reactive, watch } from "vue";
import type { ControlClient } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import { LogController, logView } from "./control-logs-state";
const props = defineProps<{ client: ControlClient }>();
const view = reactive(logView());
const controller = new LogController(props.client, view);
watch(
    () => props.client,
    client => controller.setClient(client),
    { flush: "sync" },
);
onUnmounted(() => controller.dispose());
</script>

<template>
    <section class="rounded-panel border border-border bg-surface p-5 space-y-3">
        <h2 class="text-lg font-medium">网关日志</h2>
        <p class="text-sm text-fg-secondary">
            日志可能包含平台凭据和消息内容，请勿直接分享。仅在点击后读取最近 64 KiB，不会自动刷新。
        </p>
        <UiButton :disabled="view.busy" @click="controller.refresh()">{{
            view.busy ? "读取中…" : "读取网关日志"
        }}</UiButton>
        <p v-if="view.error" role="alert">{{ view.error }}</p>
        <template v-if="view.snapshot">
            <p v-if="!view.snapshot.exists">网关尚未生成日志。</p>
            <p v-else-if="!view.snapshot.text">日志为空。</p>
            <p v-if="view.snapshot.truncated" class="text-sm">仅显示最近 64 KiB 日志。</p>
            <pre
                v-if="view.snapshot.text"
                class="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs"
                aria-label="网关日志内容"
                >{{ view.snapshot.text }}</pre
            >
        </template>
    </section>
</template>
