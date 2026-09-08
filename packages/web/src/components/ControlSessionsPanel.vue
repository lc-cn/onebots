<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { ControlClient, ControlSession } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{ client: ControlClient }>();
const emit = defineEmits<{ "revoked-self": [] }>();
const sessions = ref<ControlSession[]>([]);
const selected = ref<ControlSession>();
const busy = ref(false);
const loaded = ref(false);
const error = ref("");
const message = ref("");
let mounted = true;

function date(value: number): string {
    return new Date(value).toLocaleString();
}
function shortId(id: string): string {
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
async function refresh() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    message.value = "";
    selected.value = undefined;
    try {
        const result = await props.client.sessions();
        if (!mounted) return;
        sessions.value = result.sessions;
        loaded.value = true;
    } catch {
        if (mounted) error.value = "无法刷新设备会话；下方已有列表可能过期，请重试。";
    } finally {
        if (mounted) busy.value = false;
    }
}
async function revoke() {
    const target = selected.value;
    if (!target || busy.value) return;
    busy.value = true;
    error.value = "";
    message.value = "";
    try {
        await props.client.revokeSession(target.id);
        if (!mounted) return;
        if (target.current) {
            emit("revoked-self");
            return;
        }
        sessions.value = sessions.value.filter(session => session.id !== target.id);
        selected.value = undefined;
        message.value = "已撤销该设备会话。其他设备不受影响。";
    } catch {
        if (mounted) {
            error.value = "无法确认撤销结果，请刷新核对。若当前设备已失效，可清除本地凭据后重新授权。";
        }
    } finally {
        if (mounted) busy.value = false;
    }
}
onMounted(() => void refresh());
onUnmounted(() => {
    mounted = false;
});
</script>

<template>
    <section class="border border-border rounded-panel p-6 bg-surface space-y-4">
        <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-medium">设备会话</h2>
            <UiButton :disabled="busy" @click="refresh">刷新</UiButton>
        </div>
        <p class="text-sm text-fg-secondary">
            每次授权创建独立会话，有效期为 30 天，使用或重启不会延期。会话编号不是登录凭据。
        </p>
        <p class="text-sm text-fg-secondary">
            授权新设备：在管理服务所在机器运行
            <code class="break-all">onebots auth device --data-dir &lt;工作区&gt;</code>，
            将 5 分钟内有效的一次性设备码填入新设备登录页；已有设备保持登录。
            <code>auth recover</code> 的恢复码兑换成功后会撤销所有旧设备，请仅在需要恢复访问时使用。
        </p>
        <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
        <p v-if="message" role="status" class="text-sm text-fg-secondary">{{ message }}</p>
        <p v-if="!loaded && busy" role="status" class="text-sm text-fg-secondary">正在读取设备会话…</p>
        <p v-else-if="loaded && !sessions.length" class="text-sm text-fg-secondary">没有有效设备会话。</p>
        <ul v-if="sessions.length" class="divide-y divide-border">
            <li v-for="session in sessions" :key="session.id" class="py-3 space-y-2">
                <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-medium">
                        {{ shortId(session.id) }}{{ session.current ? " · 当前设备" : "" }}
                    </p>
                    <UiButton :disabled="busy" @click="selected = session">撤销</UiButton>
                </div>
                <p class="text-xs text-fg-secondary">
                    授权：{{ date(session.issuedAt) }} · 到期：{{ date(session.expiresAt) }}
                </p>
            </li>
        </ul>
        <div v-if="selected" class="border border-border rounded-control p-4 space-y-3">
            <p class="text-sm">
                确认撤销 {{ shortId(selected.id) }}{{ selected.current ? "（当前设备）" : "" }}？
                {{ selected.current ? "此浏览器将退出登录，重新连接需要新设备码。" : "该设备需要重新授权才能访问管理端。" }}
            </p>
            <div class="flex gap-3">
                <UiButton :disabled="busy" @click="revoke">确认撤销</UiButton>
                <UiButton :disabled="busy" @click="selected = undefined">取消</UiButton>
            </div>
        </div>
    </section>
</template>
