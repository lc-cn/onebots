<script setup lang='ts'>
import type { Component } from 'vue';
import { IconInbox } from '@tabler/icons-vue';

interface Props {
    /** 图标组件 */
    icon?: Component;
    /** 标题 */
    title?: string;
    /** 补充说明 */
    description?: string;
}

withDefaults(defineProps<Props>(), {
    icon: () => IconInbox,
    title: '暂无数据',
    description: undefined,
});
</script>

<template>
    <div class="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <component
            :is="icon"
            :size="32"
            :stroke="1.5"
            class="text-fg-tertiary"
            aria-hidden="true" />
        <p class="text-sm text-fg-secondary">{{ title }}</p>
        <p v-if="description" class="text-xs text-fg-tertiary">{{ description }}</p>
        <slot />
    </div>
</template>
