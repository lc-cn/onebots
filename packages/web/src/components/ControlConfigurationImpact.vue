<script setup lang="ts">
import { computed } from "vue";
import {
    configurationImpactSummary,
    type ConfigurationImpact,
} from "./control-configuration-impact.js";

const props = defineProps<{ impact: ConfigurationImpact; applied?: boolean; stored?: boolean }>();
const summary = computed(() =>
    props.stored && props.impact.mode !== "none"
        ? "配置将在下次启动网关时生效。"
        : props.applied && props.impact.mode === "restart"
          ? "网关已重新启动并应用配置。"
          : configurationImpactSummary(props.impact),
);
const accountActions = { add: "新增", reconnect: "重连", remove: "移除" };
const protocolActions = { add: "新增", replace: "更新", remove: "移除" };
</script>

<template>
    <section
        class="configuration-impact"
        :aria-label="stored ? '待生效配置范围' : applied ? '上次应用范围' : '配置影响范围'">
        <strong v-if="applied" class="configuration-impact-label">{{
            stored ? "已保存，待生效" : "上次应用"
        }}</strong>
        <p role="status">{{ summary }}</p>
        <p v-if="impact.mode === 'hot' && !stored" class="configuration-impact-note">
            {{ applied ? "本次仅更新受影响实例。" : "仅更新受影响实例，其他账号保持连接。" }}
        </p>
        <details v-if="impact.mode !== 'none'">
            <summary>查看影响范围</summary>
            <ul>
                <li
                    v-for="account in impact.accounts"
                    :key="`${account.platform}/${account.accountId}`">
                    {{ accountActions[account.action] }}账号：<span translate="no"
                        >{{ account.platform }}/{{ account.accountId }}</span
                    >
                </li>
                <li
                    v-for="outlet in impact.protocols"
                    :key="`${outlet.platform}/${outlet.accountId}/${outlet.name}/${outlet.version}`">
                    {{ protocolActions[outlet.action] }}协议：<span translate="no"
                        >{{ outlet.platform }}/{{ outlet.accountId }} · {{ outlet.name }}/{{
                            outlet.version
                        }}</span
                    >
                </li>
                <li v-for="field in impact.dynamicFields" :key="field">
                    动态设置：<span translate="no">{{ field }}</span>
                </li>
                <li v-for="reason in impact.restartReasons" :key="reason">
                    重启原因：{{ reason }}
                </li>
            </ul>
        </details>
    </section>
</template>

<style scoped>
.configuration-impact {
    padding: 0.875rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    min-width: 0;
}
.configuration-impact p {
    margin: 0;
    overflow-wrap: anywhere;
}
.configuration-impact-label {
    display: block;
    font-size: var(--type-caption);
    color: var(--fg-secondary);
    margin-bottom: 0.375rem;
}
.configuration-impact-note {
    color: var(--fg-secondary);
    font-size: var(--type-caption);
    margin-top: 0.375rem !important;
}
details {
    margin-top: 0.75rem;
}
summary {
    cursor: pointer;
    width: fit-content;
}
summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
}
ul {
    padding-left: 1.25rem;
    margin-bottom: 0;
}
li {
    overflow-wrap: anywhere;
    margin-top: 0.375rem;
}
</style>
