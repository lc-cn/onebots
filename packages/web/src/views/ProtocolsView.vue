<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
    ControlConfigurationSnapshot,
    ControlInstallationCatalog,
    ControlStatus,
} from "@onebots/core/control";
import { IconArrowRight, IconPlugConnected } from "@tabler/icons-vue";
import { buildAccountCards } from "../account-overview.js";
import { buildExtensionTabs, protocolKeyForPackage } from "../extension-tabs.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{
    configuration?: ControlConfigurationSnapshot;
    status?: ControlStatus;
    catalog?: ControlInstallationCatalog;
    configurationUnavailable?: boolean;
}>();
const emit = defineEmits<{
    configure: [platform: string, accountId: string, protocolKey?: string];
    detail: [platform: string, accountId: string, protocolKey: string];
    defaults: [protocolKey: string];
    showAccounts: [];
    selectExtensions: [];
}>();
const cards = computed(() =>
    buildAccountCards(props.configuration, props.status, props.catalog, window.location.origin),
);
const outlets = computed(() =>
    cards.value.flatMap(card =>
        card.protocols.map(protocol => ({
            id: protocol.guide.id,
            platform: card.platform,
            platformLabel: card.platformLabel,
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
const activeProtocolInstalled = computed(
    () => protocolTabs.value.find(item => item.key === activeProtocol.value)?.installed,
);
const visibleOutlets = computed(() =>
    outlets.value.filter(outlet => outlet.protocol.guide.protocolKey === activeProtocol.value),
);
const statusLabel = (status?: string) =>
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
            <UiButton variant="primary" @click="emit('selectExtensions')">去安装协议</UiButton>
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
                <span v-if="!activeProtocolInstalled">此协议依赖未安装；已有出口仍可查看。</span>
                <button
                    v-if="activeProtocolInstalled"
                    type="button"
                    class="entity-inline-link"
                    @click="emit('defaults', activeProtocol)">
                    全局默认值
                </button>
                <UiButton
                    v-if="activeProtocolInstalled && cards.length"
                    variant="primary"
                    size="sm"
                    @click="emit('configure', '', '', activeProtocol)"
                    >添加出口</UiButton
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
                <h2>还没有该协议出口</h2>
                <p>添加后，可以在详情页复制适合下游使用的地址。</p>
            </div>
            <div v-else class="account-card-list">
                <button
                    v-for="outlet in visibleOutlets"
                    :key="outlet.id"
                    type="button"
                    class="account-card entity-list-card"
                    @click="
                        emit(
                            'detail',
                            outlet.platform,
                            outlet.accountId,
                            outlet.protocol.guide.protocolKey,
                        )
                    ">
                    <span class="entity-list-main">
                        <strong>{{ outlet.protocol.guide.protocolLabel }}</strong>
                        <small>{{ outlet.platformLabel }} · {{ outlet.accountId }}</small>
                    </span>
                    <span class="entity-list-meta">
                        <span class="account-status" :class="outlet.protocol.status ?? 'unknown'">{{
                            statusLabel(outlet.protocol.status)
                        }}</span>
                        <small>{{
                            outlet.protocol.guide.endpoints.length
                                ? `${outlet.protocol.guide.endpoints.length} 种连接方式`
                                : "反向投递"
                        }}</small>
                    </span>
                    <IconArrowRight :size="19" aria-hidden="true" />
                </button>
            </div>
        </template>
    </section>
</template>
