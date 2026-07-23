<script setup lang='ts'>
import { computed } from 'vue';
import {
    IconInfoCircle,
    IconAlertTriangle,
    IconCircleX,
    IconCircleCheck,
    IconX,
} from '@tabler/icons-vue';

interface Props {
    /** 语义变体 */
    variant?: 'info' | 'warning' | 'danger' | 'success';
    /** 标题 */
    title?: string;
    /** 可关闭 */
    closable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    variant: 'info',
    title: undefined,
    closable: false,
});

const emit = defineEmits<{
    close: [];
}>();

const config = computed(() => {
    switch (props.variant) {
        case 'warning':
            return { icon: IconAlertTriangle, cls: 'bg-warning-soft border-warning text-warning' };
        case 'danger':
            return { icon: IconCircleX, cls: 'bg-danger-soft border-danger text-danger' };
        case 'success':
            return { icon: IconCircleCheck, cls: 'bg-success-soft border-success text-success' };
        case 'info':
        default:
            return { icon: IconInfoCircle, cls: 'bg-info-soft border-info text-info' };
    }
});
</script>

<template>
    <div
        role="alert"
        class="flex items-start gap-2.5 rounded-control border-l-2 p-3 text-sm"
        :class="config.cls">
        <component
            :is="config.icon"
            :size="18"
            :stroke="1.75"
            class="mt-0.5 shrink-0"
            aria-hidden="true" />
        <div class="min-w-0 flex-1">
            <p v-if="title" class="font-medium">{{ title }}</p>
            <div class="text-fg-secondary" :class="{ 'mt-0.5': title }">
                <slot />
            </div>
        </div>
        <button
            v-if="closable"
            type="button"
            aria-label="关闭提示"
            class="shrink-0 rounded-control p-0.5 opacity-70 transition-opacity duration-150 hover:opacity-100"
            @click="emit('close')">
            <IconX :size="14" :stroke="2" aria-hidden="true" />
        </button>
    </div>
</template>
