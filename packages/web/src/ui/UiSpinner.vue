<script setup lang="ts">
interface Props {
    /** 直径（像素） */
    size?: number;
    /** 嵌入已有可访问名称的控件时隐藏语义 */
    decorative?: boolean;
}

withDefaults(defineProps<Props>(), {
    size: 16,
    decorative: false,
});
</script>

<template>
    <svg
        class="ui-spinner shrink-0 animate-spin"
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        :role="decorative ? undefined : 'status'"
        :aria-label="decorative ? undefined : '加载中'"
        :aria-hidden="decorative || undefined">
        <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-opacity="0.25"
            stroke-width="3" />
        <path
            d="M22 12a10 10 0 0 0-10-10"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round" />
    </svg>
</template>
