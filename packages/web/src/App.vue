<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
    ControlClient,
    createHttpControlTransport,
    type ControlStatus,
} from "@onebots/core/control";
import UiButton from "./ui/UiButton.vue";
import ControlInstallationPanel from "./components/ControlInstallationPanel.vue";

const token = ref(localStorage.getItem("onebots.control.token") ?? "");
const code = ref("");
const state = ref<ControlStatus>();
const error = ref("");
const busy = ref(false);
const client = new ControlClient(createHttpControlTransport("", () => token.value));
const stateLabels = {
    starting: "正在启动",
    running: "运行中",
    stopping: "正在停止",
    stopped: "已停止",
    failed: "需要修复",
};
let refreshTimer: ReturnType<typeof setInterval> | undefined;
async function refresh() {
    if (!token.value) return;
    try {
        state.value = await client.status();
        error.value = "";
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "无法连接管理服务";
    }
}
async function pair() {
    busy.value = true;
    error.value = "";
    try {
        const result = await client.pair(code.value.trim());
        token.value = result.token;
        localStorage.setItem("onebots.control.token", result.token);
        code.value = "";
        await refresh();
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "配对失败";
    } finally {
        busy.value = false;
    }
}
async function command(action: "start" | "stop" | "restart") {
    busy.value = true;
    error.value = "";
    try {
        const result = await client.gateway(action);
        await refresh();
        if (result.status === "failed") error.value = result.error ?? "操作未完成，请检查网关状态";
    } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "操作结果暂不可确认，请刷新状态";
    } finally {
        busy.value = false;
    }
}
onMounted(() => {
    void refresh();
    refreshTimer = setInterval(() => {
        if (!busy.value) void refresh();
    }, 3000);
});
onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
    <main class="min-h-screen bg-bg text-fg px-6 py-12">
        <div class="max-w-4xl mx-auto space-y-8">
            <header class="border-b border-border pb-6">
                <p class="text-xs tracking-widest text-fg-muted mb-3">ONEBOTS</p>
                <h1 class="text-3xl font-semibold">控制台</h1>
                <p class="text-fg-secondary mt-3">管理服务保持在线，网关可以独立启动与停止。</p>
            </header>
            <p v-if="error" role="alert" class="rounded-panel border border-danger p-4 text-danger">
                {{ error }}
            </p>
            <form v-if="!token" @submit.prevent="pair" class="max-w-md space-y-4">
                <h2 class="text-lg font-medium">连接管理服务</h2>
                <p class="text-sm text-fg-secondary">
                    在本机运行
                    <code>onebots auth bootstrap --data-dir &lt;工作区&gt;</code
                    >，将单次配对码填在这里。Docker 中可通过 docker exec 运行该命令。
                </p>
                <label class="block text-sm" for="pair-code">单次配对码</label>
                <input
                    id="pair-code"
                    v-model="code"
                    type="password"
                    autocomplete="off"
                    required
                    class="w-full rounded-control border border-border bg-surface p-3" />
                <UiButton type="submit" variant="primary" :loading="busy">连接</UiButton>
            </form>
            <section v-else-if="state" class="space-y-6">
                <div class="grid sm:grid-cols-2 gap-4">
                    <div class="border border-border rounded-panel p-6 bg-surface">
                        <p class="text-sm text-fg-secondary">管理服务</p>
                        <p class="text-2xl font-semibold mt-2">在线</p>
                        <p class="text-xs text-fg-muted mt-3 break-all">{{ state.manager.id }}</p>
                    </div>
                    <div class="border border-border rounded-panel p-6 bg-surface">
                        <p class="text-sm text-fg-secondary">网关</p>
                        <p class="text-2xl font-semibold mt-2">
                            {{ stateLabels[state.gateway.actual] }}
                        </p>
                        <p class="text-sm text-fg-secondary mt-3">
                            期望状态：{{ state.gateway.desired === "running" ? "运行" : "停止" }}
                        </p>
                    </div>
                </div>
                <p v-if="state.gateway.error" role="status" class="text-danger">
                    {{ state.gateway.error }}
                </p>
                <div class="flex flex-wrap gap-3">
                    <UiButton
                        variant="primary"
                        :loading="busy"
                        :disabled="state.gateway.actual === 'running'"
                        @click="command('start')"
                        >启动网关</UiButton
                    >
                    <UiButton
                        :loading="busy"
                        :disabled="state.gateway.actual === 'stopped'"
                        @click="command('stop')"
                        >停止网关</UiButton
                    >
                    <UiButton :loading="busy" @click="command('restart')">重启网关</UiButton>
                </div>
                <p class="text-sm text-fg-secondary">
                    停止网关不会关闭此控制台。空白工作区不会自动接入平台或开启协议。
                </p>
                <ControlInstallationPanel :client="client" @applied="refresh" />
                <section v-if="state.gateway.operations.length" class="border-t border-border pt-6">
                    <h2 class="text-lg font-medium mb-3">最近操作</h2>
                    <ul class="divide-y divide-border">
                        <li
                            v-for="operation in [...state.gateway.operations].reverse().slice(0, 8)"
                            :key="operation.id"
                            class="py-3 flex justify-between gap-4 text-sm">
                            <span>{{
                                {
                                    start: "启动",
                                    stop: "停止",
                                    restart: "重启",
                                    shutdown: "管理服务退出",
                                    reconcile: "恢复核验",
                                    suspend: "切换版本暂停",
                                }[operation.action]
                            }}</span>
                            <span>{{
                                { running: "处理中", succeeded: "已完成", failed: "失败" }[
                                    operation.status
                                ]
                            }}</span>
                        </li>
                    </ul>
                </section>
            </section>
            <p v-else class="text-fg-secondary">正在连接管理服务…</p>
        </div>
    </main>
</template>
