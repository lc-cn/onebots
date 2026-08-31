<script setup lang="ts">
interface Props {
    text: string;
    placement?: 'top' | 'bottom';
}

withDefaults(defineProps<Props>(), {
    placement: 'top'
});
</script>

<template>
    <span class="group relative inline-flex">
        <slot />
        <span
            role="tooltip"
            class="pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-[#18181b] px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-surface-raised dark:text-fg"
            :class="placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'">
            {{ text }}
        </span>
    </span>
</template>
