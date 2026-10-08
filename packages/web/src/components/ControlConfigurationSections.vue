<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ControlConfigurationProjection } from "@onebots/core/control";
import type { SchemaFieldDef } from "./config/types.js";
import UiButton from "../ui/UiButton.vue";
import UiInfoTip from "../ui/UiInfoTip.vue";
import ControlConfigurationFields from "./ControlConfigurationFields.vue";
import type { ConfigurationFormGroup } from "./control-configuration-form.js";
import {
    configurationGroupIdentity,
    configurationGroupLayout,
    configuredProtocolNames,
    type ConfigurationNavigationTarget,
    type ConfigurationWorkspace,
} from "./control-configuration-layout.js";

const props = defineProps<{
    workspace: ConfigurationWorkspace;
    groups: ConfigurationFormGroup[];
    values: Record<string, unknown>;
    modes: Record<string, "keep" | "set" | "clear">;
    secretStates: ControlConfigurationProjection["secretStates"];
    adapters: string[];
    protocols: string[];
    accounts: string[];
    dirty: boolean;
    locked: boolean;
    actionBlockReason?: string;
    revealPath?: string[];
    navigationTarget?: ConfigurationNavigationTarget;
}>();
const platform = defineModel<string>("platform", { required: true });
const accountId = defineModel<string>("accountId", { required: true });
const accountTarget = defineModel<string>("accountTarget", { required: true });
const protocol = defineModel<string>("protocol", { required: true });
const emit = defineEmits<{
    selectExtensions: [];
    addAccount: [];
    removeAccount: [key: string];
    setProtocol: [enabled: boolean];
    list: [path: string[], action: "append" | "remove", index?: number];
    change: [field: SchemaFieldDef, value: unknown];
    mode: [field: SchemaFieldDef, value: string];
}>();

const layout = computed(() => configurationGroupLayout(props.groups));
const activeAccountKey = ref("");
const activeProtocolKey = ref("");
const createdAccountKey = ref("");
const createdProtocolKey = ref("");
const pendingAccountTitle = ref("");
const pendingProtocol = ref<{ target: string; name: string }>();
const protocolTargetChosen = ref(false);
let appliedNavigationRevision = 0;
const focused = computed(() => props.workspace !== "runtime" && Boolean(props.navigationTarget));
const activeAccount = computed(() => {
    if (!focused.value)
        return (
            layout.value.accounts.find(group => group.key === activeAccountKey.value) ??
            layout.value.accounts[0]
        );
    const target = props.navigationTarget;
    const key =
        target?.mode === "edit" && target.accountId
            ? JSON.stringify([`${target.platform}.${target.accountId}`])
            : createdAccountKey.value;
    return layout.value.accounts.find(group => group.key === key);
});
const activeProtocol = computed(() => {
    if (!focused.value)
        return (
            layout.value.protocols.find(group => group.key === activeProtocolKey.value) ??
            layout.value.protocols[0]
        );
    const target = props.navigationTarget;
    const key =
        target?.defaultScope && target.protocolKey
            ? JSON.stringify(["general", target.protocolKey])
            : target?.mode === "edit" && target.accountId && target.protocolKey
              ? JSON.stringify([`${target.platform}.${target.accountId}`, target.protocolKey])
              : createdProtocolKey.value;
    return layout.value.protocols.find(group => group.key === key);
});

watch(
    () => props.navigationTarget?.revision,
    () => {
        createdAccountKey.value = "";
        createdProtocolKey.value = "";
    },
);

watch(
    () => props.accounts.join("\n"),
    () => {
        // 首次进入优先配置真实账号出口；显式选择全局默认值后不再自动改动。
        if (!protocolTargetChosen.value && !accountTarget.value && props.accounts.length)
            accountTarget.value = props.accounts[0] ?? "";
    },
    { immediate: true },
);

watch(
    () => props.accounts.join("\n"),
    () => {
        // 首次进入优先配置真实账号出口；显式选择全局默认值后不再自动改动。
        if (!protocolTargetChosen.value && !accountTarget.value && props.accounts.length)
            accountTarget.value = props.accounts[0] ?? "";
    },
    { immediate: true },
);

watch(
    () => layout.value.accounts.map(group => group.key).join("\n"),
    () => {
        const requested = layout.value.accounts.find(
            group => group.title === pendingAccountTitle.value,
        );
        if (requested) {
            activeAccountKey.value = requested.key;
            createdAccountKey.value = requested.key;
            pendingAccountTitle.value = "";
        } else if (!layout.value.accounts.some(group => group.key === activeAccountKey.value))
            activeAccountKey.value = layout.value.accounts[0]?.key ?? "";
    },
    { immediate: true },
);
watch(
    () => [
        props.navigationTarget?.revision,
        layout.value.accounts.map(group => group.key).join("\n"),
    ],
    () => {
        const target = props.navigationTarget;
        if (!target || target.revision === appliedNavigationRevision) return;
        if (target.platform) platform.value = target.platform;
        if (target.protocolKey !== undefined) protocol.value = target.protocolKey;
        if (target.defaultScope) {
            protocolTargetChosen.value = true;
            accountTarget.value = "";
            appliedNavigationRevision = target.revision;
            return;
        }
        if (!target.platform || !target.accountId) {
            if (target.platform) appliedNavigationRevision = target.revision;
            return;
        }
        const accountKey = `${target.platform}.${target.accountId}`;
        if (!layout.value.accounts.some(group => group.key === JSON.stringify([accountKey])))
            return;
        activeAccountKey.value = JSON.stringify([accountKey]);
        accountTarget.value = accountKey;
        if (target.protocolKey) {
            activeProtocolKey.value = JSON.stringify([accountKey, target.protocolKey]);
        }
        appliedNavigationRevision = target.revision;
    },
    { immediate: true },
);
watch(
    () => JSON.stringify(props.revealPath ?? []),
    () => {
        const path = props.revealPath;
        if (!path?.length) return;
        const protocolGroup =
            path[0] === "general" || (path[1] && props.protocols.includes(path[1]));
        const key = JSON.stringify(protocolGroup ? path.slice(0, 2) : path.slice(0, 1));
        if (protocolGroup && layout.value.protocols.some(group => group.key === key))
            activeProtocolKey.value = key;
        else if (layout.value.accounts.some(group => group.key === key))
            activeAccountKey.value = key;
    },
    { immediate: true },
);
watch(
    () => layout.value.protocols.map(group => group.key).join("\n"),
    () => {
        const pending = pendingProtocol.value;
        const requested = pending
            ? layout.value.protocols.find(group => {
                  const identity = configurationGroupIdentity(group);
                  return (
                      identity.protocol === pending.name &&
                      (pending.target
                          ? identity.accountKey === pending.target
                          : identity.scope === "default")
                  );
              })
            : undefined;
        if (requested) {
            activeProtocolKey.value = requested.key;
            createdProtocolKey.value = requested.key;
            pendingProtocol.value = undefined;
        } else if (!layout.value.protocols.some(group => group.key === activeProtocolKey.value))
            activeProtocolKey.value = layout.value.protocols[0]?.key ?? "";
    },
    { immediate: true },
);

function createAccount() {
    pendingAccountTitle.value = `${platform.value}.${accountId.value}`;
    emit("addAccount");
}
function configureProtocol(enabled: boolean) {
    if (enabled) pendingProtocol.value = { target: accountTarget.value, name: protocol.value };
    emit("setProtocol", enabled);
}
function removeActiveProtocol() {
    if (!activeProtocol.value) return;
    const identity = configurationGroupIdentity(activeProtocol.value);
    accountTarget.value = identity.accountKey ?? "";
    protocol.value = identity.protocol ?? "";
    emit("setProtocol", false);
}
function forwardList(path: string[], action: "append" | "remove", index?: number) {
    emit("list", path, action, index);
}
function forwardChange(field: SchemaFieldDef, value: unknown) {
    emit("change", field, value);
}
function forwardMode(field: SchemaFieldDef, value: string) {
    emit("mode", field, value);
}
</script>

<template>
    <section
        v-show="workspace === 'accounts'"
        id="configuration-panel-accounts"
        aria-label="账号配置"
        class="configuration-step-panel">
        <header class="configuration-step-heading">
            <div>
                <h3>接入平台账号</h3>
            </div>
            <p>先创建平台身份，再填写该平台要求的凭据和连接参数。</p>
        </header>
        <div v-if="!focused || navigationTarget?.mode === 'create'" class="configuration-add-row">
            <label
                >平台<select v-model="platform" name="account-platform" aria-label="平台适配器">
                    <option value="">选择已安装平台</option>
                    <option v-for="name in adapters" :key="name" :value="name">{{ name }}</option>
                </select></label
            >
            <label
                >账号标识<input
                    v-model="accountId"
                    name="account-id"
                    autocomplete="off"
                    spellcheck="false"
                    aria-label="账号标识"
                    placeholder="例如 my_bot…"
            /></label>
            <UiButton
                variant="primary"
                :aria-describedby="actionBlockReason ? 'configuration-account-block' : undefined"
                :disabled="locked || dirty || !platform || !accountId"
                @click="createAccount"
                >创建账号</UiButton
            >
        </div>
        <p
            v-if="actionBlockReason"
            id="configuration-account-block"
            class="configuration-inline-hint">
            {{ actionBlockReason }}
        </p>
        <div v-if="!adapters.length" class="configuration-empty">
            <strong>还没有可用的平台适配器</strong
            ><UiButton variant="primary" @click="emit('selectExtensions')">去安装平台</UiButton>
        </div>
        <div class="configuration-object-layout">
            <aside
                v-if="layout.accounts.length && !focused"
                class="configuration-object-list"
                aria-label="平台账号列表">
                <button
                    v-for="group in layout.accounts"
                    :key="group.key"
                    type="button"
                    :aria-pressed="activeAccount?.key === group.key"
                    :class="{ active: activeAccount?.key === group.key }"
                    @click="activeAccountKey = group.key">
                    <span>{{ group.title.split(".")[0] }}</span
                    ><strong>{{ group.title.slice(group.title.indexOf(".") + 1) }}</strong
                    ><small>{{
                        configuredProtocolNames(groups, group.title).length
                            ? `${configuredProtocolNames(groups, group.title).length} 个协议出口`
                            : "尚未配置协议出口"
                    }}</small>
                </button>
            </aside>
            <div v-if="activeAccount" class="configuration-object-editor">
                <div class="configuration-object-toolbar">
                    <p>
                        编辑 <strong>{{ activeAccount.title }}</strong>
                    </p>
                    <UiButton
                        variant="danger"
                        size="sm"
                        :aria-describedby="
                            actionBlockReason ? 'configuration-account-block' : undefined
                        "
                        :aria-label="`删除账号 ${activeAccount.title}`"
                        :disabled="locked || dirty"
                        @click="emit('removeAccount', activeAccount.title)"
                        >删除账号</UiButton
                    >
                </div>
                <ControlConfigurationFields
                    :groups="[activeAccount]"
                    :values="values"
                    :modes="modes"
                    :secret-states="secretStates"
                    :reveal-path="revealPath"
                    :locked="locked"
                    :list-locked="locked || dirty"
                    @list="forwardList"
                    @change="forwardChange"
                    @mode="forwardMode" />
            </div>
            <div v-else-if="adapters.length" class="configuration-empty">
                <strong>创建第一个账号</strong><span>选择平台并填写一个便于识别的账号标识。</span>
            </div>
        </div>
    </section>

    <section
        v-show="workspace === 'protocols'"
        id="configuration-panel-protocols"
        aria-label="协议配置"
        class="configuration-step-panel">
        <header class="configuration-step-heading">
            <div>
                <h3>配置协议出口</h3>
            </div>
            <p>决定下游框架如何连接 OneBots，并为全局或单个账号设置参数。</p>
        </header>
        <div
            v-if="!focused || navigationTarget?.mode === 'create'"
            class="configuration-add-row protocol">
            <div class="configuration-scope-field">
                <div>
                    <label for="configuration-protocol-target">配置作用域</label>
                    <UiInfoTip
                        label="配置作用域说明"
                        text="全局默认值只提供可继承参数，不会自动为账号开启协议出口。要输出账号事件，请选择具体账号。" />
                </div>
                <select
                    id="configuration-protocol-target"
                    v-model="accountTarget"
                    @change="protocolTargetChosen = true">
                    <option value="">全局默认值</option>
                    <option v-for="key in accounts" :key="key" :value="key">
                        账号 · {{ key }}
                    </option>
                </select>
            </div>
            <label
                >输出协议<select v-model="protocol" aria-label="输出协议">
                    <option value="">选择已安装协议</option>
                    <option v-for="name in protocols" :key="name" :value="name">{{ name }}</option>
                </select></label
            >
            <div>
                <UiButton
                    variant="primary"
                    :aria-describedby="
                        actionBlockReason ? 'configuration-protocol-block' : undefined
                    "
                    :disabled="locked || dirty || !protocol"
                    @click="configureProtocol(true)"
                    >{{ accountTarget ? "为账号添加出口" : "设置全局默认值" }}</UiButton
                >
            </div>
        </div>
        <p
            v-if="actionBlockReason"
            id="configuration-protocol-block"
            class="configuration-inline-hint">
            {{ actionBlockReason }}
        </p>
        <div v-if="!protocols.length" class="configuration-empty">
            <strong>还没有可用的输出协议</strong>
            <UiButton variant="primary" @click="emit('selectExtensions')">去安装协议</UiButton>
        </div>
        <div class="configuration-object-layout">
            <aside
                v-if="layout.protocols.length && !focused"
                class="configuration-object-list"
                aria-label="协议配置列表">
                <button
                    v-for="group in layout.protocols"
                    :key="group.key"
                    type="button"
                    :aria-pressed="activeProtocol?.key === group.key"
                    :class="{ active: activeProtocol?.key === group.key }"
                    @click="activeProtocolKey = group.key">
                    <span>{{
                        configurationGroupIdentity(group).scope === "default"
                            ? "全局默认"
                            : configurationGroupIdentity(group).accountKey
                    }}</span
                    ><strong>{{ configurationGroupIdentity(group).protocol }}</strong
                    ><small>{{ group.fields.length }} 个配置项</small>
                </button>
            </aside>
            <div v-if="activeProtocol" class="configuration-object-editor">
                <div class="configuration-object-toolbar">
                    <p>
                        <strong>{{ configurationGroupIdentity(activeProtocol).protocol }}</strong>
                        ·
                        {{
                            configurationGroupIdentity(activeProtocol).scope === "default"
                                ? "全局默认值"
                                : configurationGroupIdentity(activeProtocol).accountKey
                        }}
                    </p>
                    <UiButton
                        variant="danger"
                        size="sm"
                        :aria-describedby="
                            actionBlockReason ? 'configuration-protocol-block' : undefined
                        "
                        :disabled="locked || dirty"
                        @click="removeActiveProtocol"
                        >移除此配置</UiButton
                    >
                </div>
                <ControlConfigurationFields
                    :groups="[activeProtocol]"
                    :values="values"
                    :modes="modes"
                    :secret-states="secretStates"
                    :reveal-path="revealPath"
                    :locked="locked"
                    :list-locked="locked || dirty"
                    @list="forwardList"
                    @change="forwardChange"
                    @mode="forwardMode" />
            </div>
            <div v-else-if="protocols.length && !focused" class="configuration-empty">
                <strong>尚未添加协议配置</strong
                ><span>先选择作用域和协议。账号出口需要明确添加到具体账号。</span>
            </div>
        </div>
    </section>

    <section
        v-show="workspace === 'runtime'"
        id="configuration-panel-runtime"
        aria-label="运行设置"
        class="configuration-step-panel">
        <header class="configuration-step-heading">
            <div>
                <h3>服务运行参数</h3>
            </div>
            <p>这些参数影响整个网关。首次接入通常可以保留默认值。</p>
        </header>
        <div class="configuration-scope-note neutral">
            <strong>通常无需修改</strong
            ><span
                >扩展安装仍在“安装与扩展”管理；这里只保留服务路径、存储、日志与加载清单等运行参数。</span
            >
        </div>
        <ControlConfigurationFields
            v-if="layout.runtime.length"
            :groups="layout.runtime"
            :values="values"
            :modes="modes"
            :secret-states="secretStates"
            :reveal-path="revealPath"
            :locked="locked"
            :list-locked="locked || dirty"
            @list="forwardList"
            @change="forwardChange"
            @mode="forwardMode" />
        <div v-else class="configuration-empty">
            <strong>没有额外运行参数</strong><span>可以直接进入确认应用。</span>
        </div>
    </section>
</template>
