<script setup lang="ts">
import type { ControlInstallOperation } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
import {
    installationPhaseLabels as phaseLabels,
    type InstallationTracking,
} from "./control-installation-tracking.js";
const privateToken = defineModel<string>({ required: true });
defineProps<{
    tracking: InstallationTracking;
    operation?: ControlInstallOperation;
    applied: boolean;
    secureTransport: boolean;
    querying: boolean;
    pending: boolean;
    watching: boolean;
    busy: boolean;
    blocked: boolean;
    terminal: boolean;
}>();
const emit = defineEmits<{
    query: [];
    toggleWatching: [];
    cancel: [];
    install: [];
    apply: [];
    newPlan: [];
}>();
</script>
<template>
    <section class="border border-border rounded-panel p-4 space-y-4" aria-live="polite">
        <p class="font-medium">
            {{
                applied
                    ? "请查看当前网关状态"
                    : operation
                      ? phaseLabels[operation.phase]
                      : "正在核实安装操作"
            }}
        </p>
        <p class="text-xs text-fg-muted break-all">操作标识：{{ tracking.id }}</p>
        <p v-if="operation?.phase === 'failed'" class="text-sm text-danger">
            依赖未通过安装或验证，当前运行版本未改变。请检查网络、授权与依赖兼容性。
        </p>
        <p v-if="operation?.phase === 'interrupted'" class="text-sm text-danger">
            安装过程被中断。保留了操作记录，请先核查，不会自动重新安装或应用。
        </p>
        <p v-if="tracking.activationRequested" class="text-sm text-fg-secondary">
            已提交过应用请求，请核查上方网关状态。刷新页面不会再次提交应用。
        </p>
        <label v-if="!operation && secureTransport" class="block space-y-2 text-sm"
            ><span>重新提供下载授权（仅私有依赖需要）</span
            ><input
                v-model="privateToken"
                type="password"
                autocomplete="off"
                maxlength="512"
                class="w-full rounded-control border border-border bg-surface p-3"
        /></label>
        <div class="flex flex-wrap gap-3">
            <UiButton :loading="querying" @click="emit('query')">查询状态</UiButton>
            <UiButton v-if="pending" @click="emit('toggleWatching')">{{
                watching ? "暂停自动刷新" : "恢复自动刷新"
            }}</UiButton>
            <UiButton v-if="pending" :loading="busy" :disabled="blocked" @click="emit('cancel')"
                >取消安装</UiButton
            >
            <UiButton v-if="!operation" :loading="busy" :disabled="blocked" @click="emit('install')"
                >重新提交同一操作</UiButton
            >
            <UiButton
                v-if="operation?.phase === 'verified' && !tracking.activationRequested"
                variant="primary"
                :loading="busy"
                :disabled="blocked"
                @click="emit('apply')"
                >应用此运行版本</UiButton
            >
            <UiButton v-if="terminal" :disabled="busy" @click="emit('newPlan')"
                >准备下一次安装</UiButton
            >
        </div>
        <p v-if="pending && !watching" class="text-xs text-fg-muted">
            已暂停刷新，后台安装仍继续；恢复刷新会查询同一操作。
        </p>
    </section>
</template>
