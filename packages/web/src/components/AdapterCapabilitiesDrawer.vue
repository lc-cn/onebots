<template>
    <UiDrawer v-model="visible" title="适配器能力" size="520px">
        <div v-if="adapters.length === 0" class="py-8">
            <UiEmpty
                title="暂无已加载的适配器"
                description="启动时通过 -r 参数加载适配器后可查看能力。" />
        </div>

        <div v-else class="flex flex-col gap-5">
            <div>
                <label class="mb-1.5 block text-xs font-medium text-fg-secondary">适配器</label>
                <UiSelect v-model="selectedPlatform" :options="adapterOptions" />
            </div>

            <template v-if="selectedAdapter">
                <div class="flex items-center gap-3 border-b border-border pb-4">
                    <UiAvatar
                        :src="selectedAdapter.icon"
                        :name="selectedAdapter.platform"
                        :size="40" />
                    <div class="min-w-0 flex-1">
                        <div class="font-medium text-fg">{{ selectedAdapter.platform }}</div>
                        <div class="text-xs text-fg-tertiary">
                            能力清单 v{{ selectedAdapter.capabilities.version }} ·
                            {{ selectedAdapter.accounts.length }} 个账号
                        </div>
                    </div>
                </div>

                <div
                    class="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-4">
                    <button
                        v-for="category in categorySummary"
                        :key="category.key"
                        type="button"
                        :aria-pressed="activeCategory === category.key"
                        class="bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-raised"
                        @click="activeCategory = category.key">
                        <div class="text-lg font-semibold tabular-nums text-fg">
                            {{ category.supported }}
                        </div>
                        <div class="text-xs text-fg-tertiary">{{ category.label }}</div>
                    </button>
                </div>

                <UiTabs v-model="activeCategory" :tabs="categoryTabs" />

                <UiEmpty
                    v-if="entries.length === 0"
                    title="此分类暂无声明"
                    description="未声明不等同于平台不支持，请以适配器文档为准。" />
                <div v-else class="divide-y divide-border border-y border-border">
                    <article v-for="entry in entries" :key="entry.name" class="py-3">
                        <div class="flex items-start justify-between gap-3">
                            <code class="break-all text-xs font-medium text-fg">{{
                                entry.name
                            }}</code>
                            <UiBadge :variant="supportMeta(entry.descriptor.support).variant">
                                {{ supportMeta(entry.descriptor.support).label }}
                            </UiBadge>
                        </div>
                        <p
                            v-if="entry.descriptor.note"
                            class="mt-1.5 text-xs leading-5 text-fg-secondary">
                            {{ entry.descriptor.note }}
                        </p>
                        <div class="mt-2 flex flex-wrap gap-1.5">
                            <UiBadge v-if="entry.descriptor.availability" variant="neutral">
                                {{ availabilityLabel(entry.descriptor.availability) }}
                            </UiBadge>
                            <UiBadge v-if="'direction' in entry.descriptor" variant="neutral">
                                {{ directionLabel(entry.descriptor.direction) }}
                            </UiBadge>
                            <UiBadge v-if="'mode' in entry.descriptor" variant="neutral">
                                {{ entry.descriptor.mode }}
                            </UiBadge>
                            <UiBadge
                                v-for="scene in entry.descriptor.scenes"
                                :key="`scene:${scene}`"
                                variant="neutral">
                                场景 {{ scene }}
                            </UiBadge>
                            <UiBadge
                                v-for="permission in entry.descriptor.permissions"
                                :key="`permission:${permission}`"
                                variant="warning">
                                权限 {{ permission }}
                            </UiBadge>
                        </div>
                    </article>
                </div>

                <p class="text-xs leading-5 text-fg-tertiary">
                    数字仅统计原生和模拟能力；明确不支持的项目仍会显示，便于确认平台边界。
                    账号权限和当前会话可能进一步限制实际可用范围。
                </p>
            </template>
        </div>
    </UiDrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiAvatar from "../ui/UiAvatar.vue";
import UiBadge from "../ui/UiBadge.vue";
import UiDrawer from "../ui/UiDrawer.vue";
import UiEmpty from "../ui/UiEmpty.vue";
import UiSelect from "../ui/UiSelect.vue";
import UiTabs from "../ui/UiTabs.vue";
import type { AdapterInfo } from "../types";
import {
    CAPABILITY_CATEGORIES,
    countSupportedCapabilities,
    getCapabilityEntries,
    type CapabilityCategory,
} from "./capability-presentation.js";

const props = defineProps<{ adapters: AdapterInfo[] }>();
const visible = defineModel<boolean>({ default: false });
const selectedPlatform = ref<string | number | boolean>();
const activeCategory = ref<CapabilityCategory>("actions");

const adapterOptions = computed(() =>
    props.adapters.map(adapter => ({ label: adapter.platform, value: adapter.platform })),
);
const selectedAdapter = computed(() =>
    props.adapters.find(adapter => adapter.platform === selectedPlatform.value),
);
const categorySummary = computed(() => {
    if (!selectedAdapter.value) return [];
    return CAPABILITY_CATEGORIES.map(category => ({
        ...category,
        supported: countSupportedCapabilities(selectedAdapter.value!.capabilities, category.key),
        total: Object.keys(selectedAdapter.value!.capabilities[category.key]).length,
    }));
});
const categoryTabs = computed(() =>
    categorySummary.value.map(category => ({
        key: category.key,
        label: `${category.label} ${category.total}`,
    })),
);
const entries = computed(() =>
    selectedAdapter.value
        ? getCapabilityEntries(selectedAdapter.value.capabilities, activeCategory.value)
        : [],
);

watch(
    () => props.adapters,
    adapters => {
        if (!adapters.some(adapter => adapter.platform === selectedPlatform.value)) {
            selectedPlatform.value = adapters[0]?.platform;
        }
    },
    { immediate: true },
);

function supportMeta(support: "native" | "emulated" | "unsupported") {
    switch (support) {
        case "native":
            return { label: "原生", variant: "success" as const };
        case "emulated":
            return { label: "模拟", variant: "warning" as const };
        case "unsupported":
            return { label: "不支持", variant: "neutral" as const };
    }
}

function availabilityLabel(availability: "always" | "permission" | "context") {
    return { always: "始终可用", permission: "需要权限", context: "依赖上下文" }[availability];
}

function directionLabel(direction: "send" | "receive" | "both") {
    return { send: "发送", receive: "接收", both: "收发" }[direction];
}
</script>
