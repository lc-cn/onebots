<template>
    <div class="h-full overflow-y-auto">
        <div class="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
            <div>
                <h1 class="text-2xl font-semibold text-fg">框架接入</h1>
                <p class="mt-1 text-sm text-fg-secondary">
                    七个接入方案可直接生成配置；另有十八个生态候选已完成资料调研。
                </p>
            </div>
            <UiAlert v-if="errorMessage" variant="danger">{{ errorMessage }}</UiAlert>
            <div v-if="loading" class="flex justify-center py-20"><UiSpinner /></div>
            <template v-else>
                <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <UiCard v-for="profile in profiles" :key="profile.id">
                        <template #header>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-semibold text-fg">{{ profile.displayName }}</span>
                                <UiBadge
                                    :variant="profile.kind === 'framework' ? 'accent' : 'info'">
                                    {{ profile.kind === "framework" ? "框架" : "发行版" }}
                                </UiBadge>
                                <UiBadge :variant="verificationVariant(profile.verification)" dot>
                                    {{ verificationLabel(profile.verification) }}
                                </UiBadge>
                            </div>
                        </template>
                        <div class="space-y-3 text-sm">
                            <div class="flex flex-wrap gap-2 text-xs text-fg-secondary">
                                <span
                                    class="rounded-control bg-surface-raised px-2 py-1 font-mono"
                                    >{{ profile.protocol }}</span
                                >
                                <span
                                    class="rounded-control bg-surface-raised px-2 py-1 font-mono"
                                    >{{ profile.transport }}</span
                                >
                            </div>
                            <div v-if="profile.distributionAudit" class="space-y-1">
                                <p class="text-fg-secondary">
                                    源码动作覆盖
                                    <strong class="text-fg">
                                        {{ profile.distributionAudit.supportedActions.length }}/{{
                                            profile.distributionAudit.requiredActions.length
                                        }}
                                    </strong>
                                    · 审计于 {{ profile.distributionAudit.auditedAt }}
                                </p>
                                <p class="font-mono text-xs text-fg-tertiary">
                                    {{ profile.distributionAudit.sourceRevision.slice(0, 12) }}
                                </p>
                                <p class="text-xs text-fg-tertiary">
                                    {{ profile.distributionAudit.note }}
                                </p>
                            </div>
                            <ul class="list-disc space-y-1 pl-5 text-xs text-fg-secondary">
                                <li v-for="item in profile.limitations" :key="item">{{ item }}</li>
                            </ul>
                            <a
                                :href="profile.upstream"
                                target="_blank"
                                rel="noreferrer"
                                class="inline-block text-xs text-accent hover:underline">
                                上游接入说明
                            </a>
                        </div>
                    </UiCard>
                </div>
                <UiCard>
                    <template #header>
                        <div>
                            <span class="font-semibold text-fg">已调研生态候选</span>
                            <p class="mt-1 text-xs font-normal text-fg-secondary">
                                候选条目仅表示已有上游依据，不代表已经完成兼容验证或配置生成器。
                            </p>
                        </div>
                    </template>
                    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <a
                            v-for="entry in ecosystem"
                            :key="entry.id"
                            :href="entry.upstream"
                            target="_blank"
                            rel="noreferrer"
                            class="rounded-control border border-border p-3 transition-colors hover:border-accent">
                            <div class="flex flex-wrap items-center gap-2">
                                <strong class="text-sm text-fg">{{ entry.displayName }}</strong>
                                <UiBadge
                                    :variant="entry.priority === 'next' ? 'accent' : 'neutral'">
                                    {{ priorityLabel(entry.priority) }}
                                </UiBadge>
                                <span class="text-xs text-fg-tertiary">{{ entry.language }}</span>
                            </div>
                            <p class="mt-2 font-mono text-xs text-accent">
                                {{ entry.protocols.join(" · ") }}
                            </p>
                            <p class="mt-2 text-xs text-fg-secondary">{{ entry.evidence }}</p>
                            <p class="mt-1 text-xs text-fg-tertiary">{{ entry.limitation }}</p>
                        </a>
                    </div>
                </UiCard>
                <UiCard>
                    <template #header
                        ><span class="font-semibold text-fg">生成接入配置</span></template
                    >
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label class="space-y-1.5 text-sm text-fg-secondary">
                            <span>机器人框架</span>
                            <UiSelect v-model="selectedFramework" :options="frameworkOptions" />
                        </label>
                        <label class="space-y-1.5 text-sm text-fg-secondary">
                            <span>OneBots 账号</span>
                            <UiInput
                                v-model="account"
                                placeholder="platform.account_id，如 qq.main" />
                        </label>
                        <label class="space-y-1.5 text-sm text-fg-secondary">
                            <span>OneBots 对外地址</span>
                            <UiInput v-model="onebotsOrigin" placeholder="http://127.0.0.1:6727" />
                        </label>
                        <label class="space-y-1.5 text-sm text-fg-secondary">
                            <span>框架监听地址（反向 WS 时使用）</span>
                            <UiInput v-model="frameworkOrigin" placeholder="留空使用该框架默认值" />
                        </label>
                    </div>
                    <div class="mt-4">
                        <UiButton :loading="generating" @click="generatePlan">生成配置</UiButton>
                    </div>
                </UiCard>
                <div v-if="plan" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <UiCard>
                        <template #header
                            ><span class="font-semibold text-fg">OneBots 配置</span></template
                        >
                        <p class="mb-3 break-all font-mono text-xs text-fg-secondary">
                            {{ plan.endpoint }}
                        </p>
                        <pre class="overflow-x-auto rounded-control bg-bg p-4 text-xs text-fg">{{
                            plan.onebotsConfig
                        }}</pre>
                    </UiCard>
                    <UiCard>
                        <template #header
                            ><span class="font-semibold text-fg">框架配置</span></template
                        >
                        <p class="mb-3 text-xs text-fg-secondary">
                            密钥统一保留为 &lt;shared-token&gt; 占位符。
                        </p>
                        <pre class="overflow-x-auto rounded-control bg-bg p-4 text-xs text-fg">{{
                            plan.frameworkConfig
                        }}</pre>
                    </UiCard>
                    <UiCard class="lg:col-span-2">
                        <template #header
                            ><span class="font-semibold text-fg">验收清单</span></template
                        >
                        <ol class="list-decimal space-y-2 pl-5 text-sm text-fg-secondary">
                            <li v-for="check in plan.checks" :key="check.name">
                                <span class="font-medium text-fg">{{ check.name }}</span
                                >：{{ check.expected }}
                                <code v-if="check.command" class="ml-2 text-xs text-accent">{{
                                    check.command
                                }}</code>
                            </li>
                        </ol>
                    </UiCard>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { buildApiUrl } from "../config.js";
import { authFetch } from "../composables/useAuth.js";
import {
    parseFrameworkCatalog,
    parseFrameworkPlan,
    type FrameworkEcosystemView,
    type FrameworkPlanView,
    type FrameworkProfileView,
} from "../framework-integration.js";
import { readManagementJsonResponse } from "../management-response.js";
import UiAlert from "../ui/UiAlert.vue";
import UiBadge from "../ui/UiBadge.vue";
import UiButton from "../ui/UiButton.vue";
import UiCard from "../ui/UiCard.vue";
import UiInput from "../ui/UiInput.vue";
import UiSelect from "../ui/UiSelect.vue";
import UiSpinner from "../ui/UiSpinner.vue";

const profiles = ref<FrameworkProfileView[]>([]);
const ecosystem = ref<FrameworkEcosystemView[]>([]);
const plan = ref<FrameworkPlanView | null>(null);
const selectedFramework = ref<string | number | boolean | undefined>();
const account = ref("");
const onebotsOrigin = ref("");
const frameworkOrigin = ref("");
const loading = ref(true);
const generating = ref(false);
const errorMessage = ref("");
const frameworkOptions = computed(() =>
    profiles.value.map(profile => ({ label: profile.displayName, value: profile.id })),
);

onMounted(async () => {
    try {
        const response = await authFetch(buildApiUrl("/api/frameworks"), { cache: "no-store" });
        const payload = await readManagementJsonResponse(response);
        if (!response.ok) throw new Error("框架目录请求失败（HTTP " + response.status + "）");
        const catalog = parseFrameworkCatalog(payload);
        profiles.value = catalog.frameworks;
        ecosystem.value = catalog.ecosystem;
        selectedFramework.value = profiles.value[0]?.id;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "框架目录不可用";
    } finally {
        loading.value = false;
    }
});

async function generatePlan() {
    generating.value = true;
    errorMessage.value = "";
    plan.value = null;
    try {
        const response = await authFetch(buildApiUrl("/api/frameworks/plan"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                framework: selectedFramework.value,
                account: account.value,
                onebotsOrigin: onebotsOrigin.value,
                frameworkOrigin: frameworkOrigin.value,
            }),
        });
        const payload = await readManagementJsonResponse(response);
        if (!response.ok) {
            const message =
                typeof payload === "object" && payload !== null && "message" in payload
                    ? String(payload.message)
                    : "生成失败（HTTP " + response.status + "）";
            throw new Error(message);
        }
        plan.value = parseFrameworkPlan(payload);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "生成接入配置失败";
    } finally {
        generating.value = false;
    }
}

function verificationLabel(level: string) {
    return level === "documented" ? "源码审计" : level === "handshake" ? "固定版本握手" : level;
}

function verificationVariant(level: string): "success" | "warning" {
    return level === "documented" ? "warning" : "success";
}

function priorityLabel(priority: FrameworkEcosystemView["priority"]): string {
    return priority === "next" ? "下一批" : priority === "later" ? "后续" : "历史项目";
}
</script>
