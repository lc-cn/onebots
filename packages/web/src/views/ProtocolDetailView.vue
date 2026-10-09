<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconCheck, IconCopy, IconPlugConnected } from "@tabler/icons-vue";
import { buildAccountCards } from "../account-overview.js";
import { normalizeConnectionOrigin } from "../components/control-connections.js";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";

const props = defineProps<{
    platform: string;
    accountId: string;
    protocolKey: string;
    configuration?: ControlConfigurationSnapshot;
    status?: ControlStatus;
    catalog?: ControlInstallationCatalog;
}>();
const emit = defineEmits<{
    back: [];
    account: [];
    edit: [];
    remove: [];
}>();
const origin = ref(window.location.origin);
const validOrigin = computed(() => normalizeConnectionOrigin(origin.value));
const account = computed(() =>
    buildAccountCards(
        props.configuration,
        props.status,
        props.catalog,
        validOrigin.value ?? window.location.origin,
    ).find(item => item.platform === props.platform && item.accountId === props.accountId),
);
const outlet = computed(() =>
    account.value?.protocols.find(item => item.guide.protocolKey === props.protocolKey),
);
const copied = ref("");
const copyError = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copyEndpoint(id: string, value: string) {
    copyError.value = "";
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        const accepted = document.execCommand("copy");
        textarea.remove();
        if (!accepted) {
            copyError.value = "浏览器未允许复制，请选中地址后手动复制。";
            return;
        }
    }
    copied.value = id;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = ""), 1800);
}
onUnmounted(() => clearTimeout(copiedTimer));
</script>

<template>
    <section class="workspace-view entity-detail-page" aria-labelledby="protocol-detail-title">
        <button type="button" class="entity-back" @click="emit('back')">← 全部协议</button>
        <div v-if="!outlet" class="accounts-empty" role="status">
            <IconPlugConnected :size="28" aria-hidden="true" />
            <h1>找不到此协议出口</h1>
            <p>配置可能已删除，或当前配置暂不可用。</p>
            <UiButton @click="emit('back')">返回协议列表</UiButton>
        </div>
        <template v-else>
            <header class="entity-detail-heading">
                <span class="entity-detail-symbol"
                    ><IconPlugConnected :size="30" aria-hidden="true"
                /></span>
                <div>
                    <span class="entity-eyebrow">协议出口</span>
                    <h1 id="protocol-detail-title">{{ outlet.guide.protocolLabel }}</h1>
                    <button type="button" class="entity-inline-link" @click="emit('account')">
                        {{ account?.platformLabel }} · {{ accountId }} →
                    </button>
                </div>
                <div class="entity-detail-actions">
                    <UiButton @click="emit('edit')">编辑协议</UiButton>
                </div>
            </header>

            <section class="entity-detail-section" aria-labelledby="protocol-connect-title">
                <div class="entity-section-heading">
                    <div>
                        <span class="entity-eyebrow">下游接入</span>
                        <h2 id="protocol-connect-title">连接方式</h2>
                    </div>
                    <strong :class="['account-status', outlet.status ?? 'unknown']">
                        {{
                            outlet.status === "ready"
                                ? "已就绪"
                                : outlet.status === "failed"
                                  ? "失败"
                                  : outlet.status === "starting"
                                    ? "启动中"
                                    : "状态待确认"
                        }}
                    </strong>
                </div>
                <div v-if="outlet.guide.endpoints.length" class="accounts-origin">
                    <label for="protocol-detail-origin">下游访问地址</label>
                    <UiInfoTip
                        label="下游访问地址说明"
                        text="下游在其他设备时，填写它能访问的 OneBots 域名或 IP；协议地址会随之更新。" />
                    <input
                        id="protocol-detail-origin"
                        v-model.trim="origin"
                        type="url"
                        autocomplete="url"
                        spellcheck="false" />
                </div>
                <p
                    v-if="outlet.guide.endpoints.length && !validOrigin"
                    class="accounts-warning"
                    role="alert">
                    请输入不含账号密码、以 http:// 或 https:// 开头的地址。
                </p>
                <p v-if="copyError" class="accounts-warning" role="alert">{{ copyError }}</p>
                <div v-if="validOrigin && outlet.guide.endpoints.length" class="account-endpoints">
                    <div
                        v-for="endpoint in outlet.guide.endpoints"
                        :key="endpoint.id"
                        class="account-endpoint">
                        <span>{{ endpoint.label }}</span>
                        <code>{{ endpoint.url }}</code>
                        <button
                            type="button"
                            :aria-label="`复制 ${endpoint.label}`"
                            @click="copyEndpoint(endpoint.id, endpoint.url)">
                            <IconCheck
                                v-if="copied === endpoint.id"
                                :size="16"
                                aria-hidden="true" />
                            <IconCopy v-else :size="16" aria-hidden="true" />
                            {{ copied === endpoint.id ? "已复制" : "复制" }}
                        </button>
                    </div>
                </div>
                <p v-if="outlet.guide.reverseTargets.length" class="account-reverse">
                    反向投递：{{
                        outlet.guide.reverseTargets
                            .map(target => `${target.label} × ${target.count}`)
                            .join(" · ")
                    }}
                </p>
                <p v-if="outlet.guide.warning" class="accounts-warning">
                    {{ outlet.guide.warning }}
                </p>
            </section>
            <section
                class="entity-detail-section entity-danger-section"
                aria-labelledby="protocol-manage-title">
                <h2 id="protocol-manage-title">管理出口</h2>
                <p>移除后，下游将无法再通过此协议连接该账号；账号本身和其他协议保持连接。</p>
                <UiButton variant="danger" size="sm" @click="emit('remove')">移除协议出口</UiButton>
            </section>
        </template>
    </section>
</template>
