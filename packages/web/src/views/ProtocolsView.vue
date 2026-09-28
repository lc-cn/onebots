<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconAlertTriangle, IconCheck, IconCopy, IconPlugConnected } from "@tabler/icons-vue";
import { buildAccountCards } from "../account-overview.js";
import { buildExtensionTabs, protocolKeyForPackage } from "../extension-tabs.js";
import { normalizeConnectionOrigin } from "../components/control-connections.js";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";

const props = defineProps<{
    configuration?: ControlConfigurationSnapshot;
    status?: ControlStatus;
    catalog?: ControlInstallationCatalog;
    configurationUnavailable?: boolean;
    focusedAccount?: { platform: string; accountId: string };
}>();
const emit = defineEmits<{
    configure: [platform: string, accountId: string, protocolKey?: string];
    configureAccount: [platform: string, accountId: string];
    remove: [platform: string, accountId: string, protocolKey: string];
    showAccounts: [];
    clearAccount: [];
    selectExtensions: [];
}>();
const connectionOrigin = ref(window.location.origin);
const normalizedOrigin = computed(() => normalizeConnectionOrigin(connectionOrigin.value));
const localOnly = computed(() => {
    if (!normalizedOrigin.value) return false;
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
        new URL(normalizedOrigin.value).hostname,
    );
});
const cards = computed(() =>
    buildAccountCards(
        props.configuration,
        props.status,
        props.catalog,
        normalizedOrigin.value ?? window.location.origin,
    ),
);
const outlets = computed(() =>
    cards.value.flatMap(card =>
        card.protocols.map(protocol => ({
            id: protocol.guide.id,
            platform: card.platform,
            accountId: card.accountId,
            protocol,
        })),
    ),
);
const protocolTabs = computed(() =>
    buildExtensionTabs(
        props.catalog?.selection.protocols ?? [],
        props.catalog?.protocols ?? [],
        outlets.value.map(outlet => outlet.protocol.guide.protocolKey),
        protocolKeyForPackage,
    ),
);
const activeProtocol = ref("");
watch(
    protocolTabs,
    value => {
        if (!value.some(item => item.key === activeProtocol.value))
            activeProtocol.value = value[0]?.key ?? "";
    },
    { immediate: true },
);
watch(
    () => props.focusedAccount,
    account => {
        if (!account) return;
        const first = outlets.value.find(
            outlet => outlet.platform === account.platform && outlet.accountId === account.accountId,
        );
        if (first) activeProtocol.value = first.protocol.guide.protocolKey;
    },
    { immediate: true },
);
const activeProtocolInstalled = computed(
    () => protocolTabs.value.find(item => item.key === activeProtocol.value)?.installed,
);
const visibleOutlets = computed(() =>
    outlets.value.filter(
        outlet =>
            outlet.protocol.guide.protocolKey === activeProtocol.value &&
            (!props.focusedAccount ||
                (outlet.platform === props.focusedAccount.platform &&
                    outlet.accountId === props.focusedAccount.accountId)),
    ),
);
const copied = ref("");
const copyError = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const protocolStatusLabel = (status?: string) =>
    status
        ? {
              pending: "等待中",
              starting: "启动中",
              ready: "已就绪",
              stopping: "停止中",
              stopped: "已停止",
              failed: "失败",
          }[status]
        : "状态待确认";

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
    copiedTimer = setTimeout(() => {
        if (copied.value === id) copied.value = "";
    }, 1800);
}

onUnmounted(() => clearTimeout(copiedTimer));
</script>

<template>
    <section
        class="workspace-view accounts-workspace protocols-workspace"
        aria-labelledby="protocols-title">
        <header class="page-heading accounts-heading">
            <div>
                <h1 id="protocols-title">协议</h1>
                <p>{{ outlets.length }} 个账号出口</p>
            </div>
        </header>

        <div v-if="focusedAccount" class="protocols-focus">
            <span>只看 {{ focusedAccount.platform }} · {{ focusedAccount.accountId }}</span>
            <button type="button" @click="emit('clearAccount')">查看全部账号</button>
        </div>
        <div v-if="outlets.length" class="accounts-origin">
            <label for="protocols-origin">下游访问地址</label>
            <UiInfoTip
                label="下游访问地址说明"
                text="协议 URL 基于这个地址生成。下游在其他设备时，请填写它能访问的 OneBots 域名或 IP。" />
            <input
                id="protocols-origin"
                v-model.trim="connectionOrigin"
                type="url"
                name="connection-origin"
                inputmode="url"
                autocomplete="url"
                spellcheck="false" />
        </div>
        <p v-if="outlets.length && !normalizedOrigin" class="accounts-warning" role="alert">
            请输入不含账号密码、以 http:// 或 https:// 开头的地址。
        </p>
        <p v-else-if="outlets.length && localOnly" class="accounts-local-note">
            当前是本机地址；其他设备上的下游应用需要填写可访问的服务器地址。
        </p>
        <p v-if="copyError" class="accounts-warning" role="alert">{{ copyError }}</p>
        <p v-if="configurationUnavailable" class="accounts-warning" role="alert">
            配置暂不可用；协议地址待恢复后展示。
        </p>

        <div v-if="!catalog && !outlets.length" class="accounts-empty" role="status">
            {{ configurationUnavailable ? "协议信息暂不可用" : "正在读取协议状态…" }}
        </div>
        <div v-else-if="!protocolTabs.length" class="accounts-empty">
            <IconPlugConnected :size="30" aria-hidden="true" />
            <h2>还没有任何协议能输出呢</h2>
            <p>先去扩展安装协议，安装后就能为账号添加出口。</p>
            <div>
                <UiButton variant="primary" @click="emit('selectExtensions')">去安装协议</UiButton>
            </div>
        </div>
        <template v-else>
            <div class="entity-tabs" role="group" aria-label="协议分类">
                <button
                    v-for="item in protocolTabs"
                    :key="item.key"
                    type="button"
                    :aria-pressed="activeProtocol === item.key"
                    :class="{ active: activeProtocol === item.key }"
                    @click="activeProtocol = item.key">
                    {{ item.label }} <span>{{ item.count }}</span>
                </button>
            </div>
            <div class="entity-tab-actions">
                <span v-if="!activeProtocolInstalled">此协议依赖未安装；可删除旧出口配置。</span>
                <UiButton
                    v-if="activeProtocolInstalled && cards.length"
                    variant="primary"
                    size="sm"
                    @click="
                        emit(
                            'configure',
                            focusedAccount?.platform ?? '',
                            focusedAccount?.accountId ?? '',
                            activeProtocol,
                        )
                    "
                    >添加</UiButton
                >
                <UiButton
                    v-else-if="!cards.length"
                    variant="primary"
                    size="sm"
                    @click="emit('showAccounts')"
                    >先创建账号</UiButton
                >
                <UiButton v-else variant="ghost" size="sm" @click="emit('selectExtensions')"
                    >安装协议</UiButton
                >
            </div>
            <div v-if="!visibleOutlets.length" class="accounts-empty">
                <IconPlugConnected :size="30" aria-hidden="true" />
                <h2>{{ focusedAccount ? "此账号尚未添加该协议出口" : "还没有该协议出口" }}</h2>
            </div>
            <div v-else class="account-card-list">
                <article
                    v-for="outlet in visibleOutlets"
                    :key="outlet.id"
                    class="account-card account-protocol">
                    <header class="account-protocol-heading">
                        <div>
                            <h2>{{ outlet.protocol.guide.protocolLabel }}</h2>
                            <span :class="outlet.protocol.status ?? 'unknown'">{{
                                protocolStatusLabel(outlet.protocol.status)
                            }}</span>
                            <small>{{ outlet.platform }} · {{ outlet.accountId }}</small>
                        </div>
                        <div class="account-protocol-actions">
                            <UiButton
                                variant="ghost"
                                size="sm"
                                @click="
                                    emit('configureAccount', outlet.platform, outlet.accountId)
                                ">
                                查看账号
                            </UiButton>
                            <UiButton
                                variant="ghost"
                                size="sm"
                                @click="
                                    emit(
                                        'configure',
                                        outlet.platform,
                                        outlet.accountId,
                                        outlet.protocol.guide.protocolKey,
                                    )
                                ">
                                编辑协议
                            </UiButton>
                            <UiButton
                                variant="ghost"
                                size="sm"
                                @click="
                                    emit(
                                        'remove',
                                        outlet.platform,
                                        outlet.accountId,
                                        outlet.protocol.guide.protocolKey,
                                    )
                                "
                                >删除</UiButton
                            >
                        </div>
                    </header>
                    <div
                        v-if="normalizedOrigin && outlet.protocol.guide.endpoints.length"
                        class="account-endpoints">
                        <div
                            v-for="endpoint in outlet.protocol.guide.endpoints"
                            :key="endpoint.id"
                            class="account-endpoint">
                            <span>{{ endpoint.label }}</span>
                            <code>{{ endpoint.url }}</code>
                            <button
                                type="button"
                                :aria-label="`复制 ${outlet.accountId} ${outlet.protocol.guide.protocolLabel} ${endpoint.label}`"
                                @click="copyEndpoint(`${outlet.id}:${endpoint.id}`, endpoint.url)">
                                <IconCheck
                                    v-if="copied === `${outlet.id}:${endpoint.id}`"
                                    :size="16"
                                    aria-hidden="true" />
                                <IconCopy v-else :size="16" aria-hidden="true" />
                                {{ copied === `${outlet.id}:${endpoint.id}` ? "已复制" : "复制" }}
                            </button>
                        </div>
                    </div>
                    <p
                        v-else-if="outlet.protocol.guide.reverseTargets.length"
                        class="account-reverse">
                        仅配置反向投递：{{
                            outlet.protocol.guide.reverseTargets
                                .map(target => `${target.label} × ${target.count}`)
                                .join(" · ")
                        }}
                    </p>
                    <p v-if="outlet.protocol.guide.warning" class="accounts-warning">
                        <IconAlertTriangle :size="16" aria-hidden="true" />{{
                            outlet.protocol.guide.warning
                        }}
                    </p>
                </article>
            </div>
        </template>
        <div id="protocol-configuration-target" class="configuration-owner-target"></div>
    </section>
</template>
