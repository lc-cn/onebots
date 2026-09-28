<script setup lang="ts">
import { computed } from "vue";
import UiSpinner from "./UiSpinner.vue";

interface Props {
    /** primary 仅用于当前任务主操作；secondary 为常规操作；ghost 为低优先级；danger 为破坏性操作。 */
    variant?: "primary" | "secondary" | "ghost" | "danger";
    /** 尺寸 */
    size?: "sm" | "md";
    /** 加载中（显示 Spinner 并禁用） */
    loading?: boolean;
    /** 禁用 */
    disabled?: boolean;
    /** 原生 type */
    type?: "button" | "submit";
}

const props = withDefaults(defineProps<Props>(), {
    variant: "secondary",
    size: "md",
    loading: false,
    disabled: false,
    type: "button",
});

const isDisabled = computed(() => props.disabled || props.loading);

const variantClass = computed(() => {
    switch (props.variant) {
        case "primary":
            return "bg-accent text-accent-fg hover:bg-accent-hover";
        case "ghost":
            return "bg-transparent text-fg-secondary hover:bg-surface-raised hover:text-fg";
        case "danger":
            return "ui-button-danger";
        case "secondary":
        default:
            return "bg-surface border border-border text-fg hover:bg-surface-raised";
    }
});

const sizeClass = computed(() => (props.size === "sm" ? "h-7 px-3 text-xs" : "h-9 px-4 text-sm"));
</script>

<template>
    <button
        :type="type"
        :disabled="isDisabled"
        :aria-busy="loading || undefined"
        class="ui-button inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap select-none transition-[transform,opacity,background-color] duration-150 focus-visible:shadow-[0_0_0_3px_var(--ring)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        :class="[variantClass, sizeClass]">
        <UiSpinner v-if="loading" :size="14" decorative />
        <slot />
    </button>
</template>
