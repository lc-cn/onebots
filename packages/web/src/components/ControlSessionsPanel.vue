<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { ControlClient, ControlSession, ControlSessionPolicy } from "@onebots/core/control";
import { IconDeviceDesktop, IconKey } from "@tabler/icons-vue";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    client: ControlClient;
    configurationDirty?: boolean;
    active?: boolean;
}>();
const emit = defineEmits<{ "revoked-self": [] }>();
const sessions = ref<ControlSession[]>([]);
const selected = ref<ControlSession>();
const busy = ref(false);
const loaded = ref(false);
const error = ref("");
const message = ref("");
const deviceCode = ref("");
const codeExpiresAt = ref(0);
const policy = ref<ControlSessionPolicy>({ durationDays: 30, autoRenew: true });
const policyLoaded = ref(false);
let mounted = true;
let codeTimer: ReturnType<typeof setTimeout> | undefined;

function clearCode() {
    deviceCode.value = "";
    codeExpiresAt.value = 0;
    if (codeTimer) clearTimeout(codeTimer);
    codeTimer = undefined;
}

watch(
    () => props.active,
    active => {
        if (!active) clearCode();
    },
);

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
        const [result, currentPolicy] = await Promise.all([
            props.client.sessions(),
            props.client.sessionPolicy(),
        ]);
        if (!mounted) return;
        sessions.value = result.sessions;
        policy.value = currentPolicy;
        policyLoaded.value = true;
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
    if (
        target.current &&
        props.configurationDirty &&
        !window.confirm("配置中还有未保存的本地修改。撤销当前设备后这些修改会丢失，是否继续？")
    )
        return;
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
            error.value =
                "无法确认撤销结果，请刷新核对。若当前设备已失效，可清除本地凭据后重新授权。";
        }
    } finally {
        if (mounted) busy.value = false;
    }
}
async function issueDevice() {
    if (busy.value) return;
    clearCode();
    busy.value = true;
    error.value = "";
    message.value = "";
    try {
        const result = await props.client.authorizeWebDevice();
        if (!mounted || props.active === false) return;
        deviceCode.value = result.code;
        codeExpiresAt.value = result.expiresAt;
        codeTimer = setTimeout(clearCode, Math.max(0, result.expiresAt - Date.now()));
    } catch {
        if (mounted) error.value = "设备码未能签发，请刷新授权状态后重试。";
    } finally {
        if (mounted) busy.value = false;
    }
}
async function copyCode() {
    if (!deviceCode.value || Date.now() >= codeExpiresAt.value) return;
    try {
        await navigator.clipboard.writeText(deviceCode.value);
        message.value = "已复制设备码。请只在可信的新设备上使用。";
    } catch {
        error.value = "复制失败，请手动选中设备码复制。";
    }
}
async function savePolicy() {
    if (busy.value || !policyLoaded.value) return;
    busy.value = true;
    error.value = "";
    message.value = "";
    try {
        policy.value = await props.client.updateSessionPolicy(policy.value);
        const { session } = await props.client.renewSession();
        if (!mounted) return;
        sessions.value = sessions.value.map(item => (item.current ? session : item));
        message.value = "会话设置已保存，当前浏览器的授权期限已更新。";
    } catch {
        if (mounted) error.value = "无法确认设置或续期结果，请刷新后核对。";
    } finally {
        if (mounted) busy.value = false;
    }
}
async function renewCurrent() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    message.value = "";
    try {
        const { session } = await props.client.renewSession();
        if (!mounted) return;
        sessions.value = sessions.value.map(item => (item.current ? session : item));
        message.value = "当前浏览器会话已检查，期限已是最新。";
    } catch {
        if (mounted) error.value = "续期未能确认，请稍后重试。";
    } finally {
        if (mounted) busy.value = false;
    }
}
onMounted(() => void refresh());
onUnmounted(() => {
    mounted = false;
    clearCode();
});
</script>

<template>
    <section class="border border-border rounded-panel p-6 bg-surface space-y-4">
        <div class="flex items-center justify-between gap-3">
            <h2 class="panel-title">
                <IconDeviceDesktop :size="21" aria-hidden="true" />已授权设备
                <span class="count-badge">{{ loaded ? sessions.length : "—" }}</span>
            </h2>
            <UiButton :disabled="busy" @click="refresh">刷新</UiButton>
        </div>
        <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
        <p v-if="message" role="status" class="text-sm text-fg-secondary">{{ message }}</p>
        <div class="border border-border rounded-control p-4 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 class="font-semibold">连接新设备</h3>
                    <p class="text-sm text-fg-secondary">生成一次性设备码，在新设备登录页输入。</p>
                </div>
                <UiButton :disabled="busy" @click="issueDevice">生成设备码</UiButton>
            </div>
            <div v-if="deviceCode" class="space-y-2">
                <code
                    class="block break-all rounded-control border border-border bg-surface-raised p-3 select-all"
                    >{{ deviceCode }}</code
                >
                <div
                    class="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-secondary">
                    <span>仅显示本次，{{ date(codeExpiresAt) }} 失效；重新生成会使旧码失效。</span>
                    <UiButton variant="ghost" @click="copyCode">复制</UiButton>
                </div>
            </div>
        </div>
        <div v-if="policyLoaded" class="border border-border rounded-control p-4 space-y-3">
            <div>
                <h3 class="font-semibold">登录有效期</h3>
                <p class="text-sm text-fg-secondary">
                    授权可随时撤销；自动续期只在此浏览器仍在使用且会话有效时执行。
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-2 text-sm">
                    <span>有效期</span>
                    <select
                        v-model.number="policy.durationDays"
                        class="border border-border rounded-control bg-surface px-3 py-2">
                        <option :value="30">30 天</option>
                        <option :value="90">90 天</option>
                        <option :value="365">365 天</option>
                    </select>
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <input v-model="policy.autoRenew" type="checkbox" />使用时自动续期
                </label>
            </div>
            <div class="flex flex-wrap gap-2">
                <UiButton :disabled="busy" @click="savePolicy">保存设置并更新当前会话</UiButton>
                <UiButton variant="ghost" :disabled="busy" @click="renewCurrent">检查续期</UiButton>
            </div>
        </div>
        <p v-if="!loaded && busy" role="status" class="text-sm text-fg-secondary">
            正在读取设备会话…
        </p>
        <p v-else-if="loaded && !sessions.length" class="text-sm text-fg-secondary">
            没有有效设备会话。
        </p>
        <ul v-if="sessions.length" class="session-list">
            <li
                v-for="session in sessions"
                :key="session.id"
                class="session-row"
                :class="{ current: session.current }">
                <span class="session-device-icon"
                    ><IconDeviceDesktop :size="22" aria-hidden="true"
                /></span>
                <div class="session-identity">
                    <strong>{{ session.current ? "当前浏览器" : "已授权会话" }}</strong>
                    <code>{{ shortId(session.id) }}</code>
                </div>
                <dl class="session-dates">
                    <div>
                        <dt>授权时间</dt>
                        <dd>{{ date(session.issuedAt) }}</dd>
                    </div>
                    <div>
                        <dt>有效期至</dt>
                        <dd>{{ date(session.expiresAt) }}</dd>
                    </div>
                </dl>
                <UiButton
                    variant="ghost"
                    :disabled="busy"
                    :aria-label="`撤销会话 ${shortId(session.id)}`"
                    @click="selected = session"
                    >撤销访问</UiButton
                >
            </li>
        </ul>
        <details class="access-help">
            <summary><IconKey :size="18" aria-hidden="true" />连接新设备与恢复访问</summary>
            <p class="text-sm text-fg-secondary">
                无法使用此浏览器时，也可在管理服务所在机器运行
                <code class="break-all">onebots auth device --data-dir &lt;工作区&gt;</code>， 将 5
                分钟内有效的一次性设备码填入新设备登录页；已有设备保持登录。
                <code>auth recover</code>
                的恢复码兑换成功后会撤销所有旧设备，请仅在需要恢复访问时使用。
            </p>
        </details>
        <div v-if="selected" class="border border-border rounded-control p-4 space-y-3">
            <p class="text-sm">
                确认撤销 {{ shortId(selected.id) }}{{ selected.current ? "（当前设备）" : "" }}？
                {{
                    selected.current
                        ? "此浏览器将退出登录，重新连接需要新设备码。"
                        : "该设备需要重新授权才能访问管理端。"
                }}
            </p>
            <div class="flex gap-3">
                <UiButton :disabled="busy" @click="revoke">确认撤销</UiButton>
                <UiButton :disabled="busy" @click="selected = undefined">取消</UiButton>
            </div>
        </div>
    </section>
</template>
