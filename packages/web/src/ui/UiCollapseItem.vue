<script setup lang="ts">
import { computed, inject, useId } from "vue";
import { IconChevronDown } from "@tabler/icons-vue";
import { collapseContextKey } from "./collapseContext.js";

interface Props {
    /** 唯一标识 */
    name: string;
    /** 标题（可被 title 插槽覆盖） */
    title?: string;
}

const props = withDefaults(defineProps<Props>(), {
    title: "",
});

const collapse = inject(collapseContextKey);
if (!collapse) {
    throw new Error("UiCollapseItem 必须放在 UiCollapse 内使用");
}
const context = collapse;

const expanded = computed(() => context.activeNames.value.includes(props.name));

const baseId = useId();
const headerId = `collapse-header-${baseId}`;
const panelId = `collapse-panel-${baseId}`;
</script>

<template>
    <div class="border-b border-border">
        <h3>
            <button
                :id="headerId"
                type="button"
                :aria-expanded="expanded"
                :aria-controls="panelId"
                class="flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium text-fg transition-colors duration-150 hover:text-accent"
                @click="context.toggle(name)">
                <slot name="title">{{ title }}</slot>
                <IconChevronDown
                    :size="16"
                    stroke="1.75"
                    class="shrink-0 text-fg-tertiary transition-transform duration-200"
                    :class="{ 'rotate-180': expanded }"
                    aria-hidden="true" />
            </button>
        </h3>
        <div
            class="grid transition-[grid-template-rows] duration-200 ease-out"
            :class="expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
            <div class="overflow-hidden">
                <div
                    :id="panelId"
                    role="region"
                    :aria-labelledby="headerId"
                    class="pb-3 text-sm text-fg-secondary">
                    <slot />
                </div>
            </div>
        </div>
    </div>
</template>
