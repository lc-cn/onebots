<script setup lang="ts">
import type { ControlInstallPlan } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
defineProps<{
    plan: ControlInstallPlan;
    upgrade: boolean;
    privateNeeded: boolean;
    secureTransport: boolean;
    busy: boolean;
}>();
defineEmits<{ install: [] }>();
const privateToken = defineModel<string>({ required: true });
const removalLabels = (plan: ControlInstallPlan) => [
    ...plan.removed.adapters.map(name => `适配器 ${name}`),
    ...plan.removed.protocols.map(name => `协议 ${name}`),
    ...plan.removed.applications.map(name => `框架 ${name}`),
];
</script>
<template>
    <section class="border border-border rounded-panel p-4 space-y-4">
        <h3 class="font-medium">
            {{
                upgrade
                    ? "确认网关升级计划"
                    : removalLabels(plan).length
                      ? "确认扩展移除候选"
                      : "确认安装计划"
            }}
        </h3>
        <p class="text-sm text-fg-secondary">
            {{
                upgrade
                    ? "保留已安装平台、协议和框架；安装验证后仍需手动应用。"
                    : removalLabels(plan).length
                      ? "当前活动目录不会被修改。新候选安装并验证后仍需手动应用；配置、账号和协议状态不会自动改变。"
                      : "这是完整集合。安装验证后仍需手动应用。"
            }}
        </p>
        <div
            v-if="removalLabels(plan).length"
            class="border border-danger/40 rounded-control p-3 text-sm text-danger">
            <p class="font-medium">应用候选后移除：</p>
            <ul class="mt-2 space-y-1">
                <li v-for="item in removalLabels(plan)" :key="item">{{ item }}</li>
            </ul>
        </div>
        <ul class="text-sm space-y-1 break-all">
            <li v-for="item in plan.packages" :key="item.name">
                {{ item.name }} <span class="text-fg-muted">{{ item.version }}</span>
            </li>
        </ul>
        <details v-if="plan.peers.length" class="text-sm">
            <summary class="cursor-pointer">必需对等依赖（{{ plan.peers.length }} 项）</summary>
            <ul class="mt-2 space-y-1 break-all">
                <li v-for="peer in plan.peers" :key="`${peer.requestedBy}:${peer.packageName}`">
                    {{ peer.packageName }} {{ peer.range
                    }}<span class="block text-xs text-fg-muted">{{ peer.requestedBy }} 需要</span>
                </li>
            </ul>
        </details>
        <p
            v-for="recommendation in plan.recommendations"
            :key="recommendation"
            class="text-sm text-fg-secondary">
            {{ recommendation }}
        </p>
        <label v-if="privateNeeded" class="block space-y-2 text-sm">
            <span>GitHub Packages 读取授权（read:packages）</span>
            <input
                v-model="privateToken"
                type="password"
                autocomplete="off"
                spellcheck="false"
                maxlength="512"
                :disabled="!secureTransport"
                class="w-full rounded-control border border-border bg-surface p-3" />
            <span class="block text-xs text-fg-muted"
                >仅用于这次下载，提交后清空，不保存到浏览器或配置。{{
                    secureTransport ? "" : "请通过 HTTPS 或本机连接提交。"
                }}</span
            >
        </label>
        <UiButton
            variant="primary"
            :loading="busy"
            :disabled="!!privateNeeded && (!privateToken || !secureTransport)"
            @click="$emit('install')"
            >确认并安装</UiButton
        >
    </section>
</template>
