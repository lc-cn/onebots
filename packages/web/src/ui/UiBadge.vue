<script setup lang='ts'>
import { computed } from 'vue';

interface Props {
    /** 语义变体 */
    variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';
    /** 是否前置状态圆点 */
    dot?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    variant: 'neutral',
    dot: false,
});

const variantClass = computed(() => {
    switch (props.variant) {
        case 'success':
            return 'bg-success-soft text-success';
        case 'warning':
            return 'bg-warning-soft text-warning';
        case 'danger':
            return 'bg-danger-soft text-danger';
        case 'info':
            return 'bg-info-soft text-info';
        case 'accent':
            return 'bg-accent-soft text-accent';
        case 'neutral':
        default:
            return 'bg-surface-raised text-fg-secondary';
    }
});
</script>

<template>
    <span
        class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
        :class="variantClass">
        <span v-if="dot" class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
        <slot />
    </span>
</template>
