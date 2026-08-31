<template>
    <div
        v-if="!capability.declared || !capability.manifest || !capability.summary"
        class="rounded-card border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-5 text-fg-secondary">
        {{
            capability.source === "runtime"
                ? "当前插件未声明默认能力清单，请将未声明能力视为未知。"
                : "能力目录暂未收录此适配器，请安装后查看插件运行时清单。"
        }}
    </div>

    <details
        v-else
        :open="expanded"
        class="group rounded-card border border-border-subtle"
        @toggle="handleToggle">
        <summary class="cursor-pointer list-none p-3 select-none">
            <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-medium text-fg">
                    平台能力 ·
                    {{ capability.source === "runtime" ? "当前插件" : "目录快照" }}
                    <template v-if="capability.packageVersion">
                        v{{ capability.packageVersion }}
                    </template>
                </span>
                <span class="text-xs text-accent group-open:hidden">展开完整清单</span>
                <span class="hidden text-xs text-accent group-open:inline">收起</span>
            </div>
            <div class="mt-3 grid grid-cols-4 gap-2">
                <div v-for="category in categories" :key="category.key">
                    <div class="text-sm font-semibold tabular-nums text-fg">
                        {{ capability.summary[category.key].supported }}/{{
                            capability.summary[category.key].total
                        }}
                    </div>
                    <div class="text-xs text-fg-tertiary">{{ category.label }}</div>
                </div>
            </div>
        </summary>

        <div v-if="expanded" class="space-y-4 border-t border-border-subtle p-3">
            <section v-for="category in visibleCategories" :key="category.key">
                <div class="mb-2 flex items-center justify-between gap-3">
                    <h3 class="text-xs font-semibold text-fg-secondary">{{ category.label }}</h3>
                    <span class="text-xs text-fg-tertiary">
                        原生 {{ capability.summary[category.key].native }} · 模拟
                        {{ capability.summary[category.key].emulated }} · 不支持
                        {{ capability.summary[category.key].unsupported }}
                    </span>
                </div>
                <p v-if="entries(category.key).length === 0" class="text-xs text-fg-tertiary">
                    暂无声明
                </p>
                <div v-else class="divide-y divide-border-subtle border-y border-border-subtle">
                    <article
                        v-for="entry in entries(category.key)"
                        :key="entry.name"
                        class="py-2.5">
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
                            class="mt-1 text-xs leading-5 text-fg-secondary">
                            {{ entry.descriptor.note }}
                        </p>
                        <div class="mt-1.5 flex flex-wrap gap-1.5">
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
                                v-for="permission in entry.descriptor.permissions"
                                :key="permission"
                                variant="warning">
                                权限 {{ permission }}
                            </UiBadge>
                        </div>
                    </article>
                </div>
            </section>
            <p class="text-xs leading-5 text-fg-tertiary">
                {{
                    capability.source === "runtime"
                        ? "默认清单来自当前已加载插件。"
                        : "目录快照随当前 OneBots 版本发布，安装后以插件实际注册清单为准。"
                }}
                账号 token、权限和事件订阅可能进一步收窄实际可用范围。
            </p>
        </div>
    </details>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CapabilityAvailability, CapabilityDirection, CapabilitySupport } from "@onebots/core";
import type { ExtensionCapabilityInfo } from "../types";
import UiBadge from "../ui/UiBadge.vue";
import {
    CAPABILITY_CATEGORIES,
    getCapabilityEntries,
    type CapabilityCategory,
} from "./capability-presentation.js";
import { getCapabilitySearchMatches } from "./capability-search.js";

const props = withDefaults(defineProps<{ capability: ExtensionCapabilityInfo; query?: string }>(), {
    query: "",
});
const categories = CAPABILITY_CATEGORIES;
const expanded = ref(false);
const matchingEntries = computed(() =>
    props.capability.manifest
        ? getCapabilitySearchMatches(props.capability.manifest, props.query)
        : [],
);
const matchingKeys = computed(
    () => new Set(matchingEntries.value.map(entry => `${entry.category}:${entry.name}`)),
);
const visibleCategories = computed(() =>
    matchingEntries.value.length > 0
        ? categories.filter(category =>
              matchingEntries.value.some(entry => entry.category === category.key),
          )
        : categories,
);

watch(
    () => matchingEntries.value.length,
    count => {
        if (count > 0) expanded.value = true;
    },
    { immediate: true },
);

function handleToggle(event: Event): void {
    expanded.value = (event.currentTarget as HTMLDetailsElement).open;
}

function entries(category: CapabilityCategory) {
    const allEntries = props.capability.manifest
        ? getCapabilityEntries(props.capability.manifest, category)
        : [];
    return matchingEntries.value.length > 0
        ? allEntries.filter(entry => matchingKeys.value.has(`${category}:${entry.name}`))
        : allEntries;
}

function supportMeta(support: CapabilitySupport) {
    switch (support) {
        case "native":
            return { label: "原生", variant: "success" as const };
        case "emulated":
            return { label: "模拟", variant: "warning" as const };
        case "unsupported":
            return { label: "不支持", variant: "neutral" as const };
    }
}

function availabilityLabel(availability: CapabilityAvailability): string {
    return { always: "始终可用", permission: "需要权限", context: "依赖上下文" }[availability];
}

function directionLabel(direction: CapabilityDirection): string {
    return { send: "发送", receive: "接收", both: "双向" }[direction];
}
</script>
