<script setup lang='ts'>
import { useSlots, computed } from 'vue';

defineOptions({ name: 'UiCard' });

const slots = useSlots();
const hasHeader = computed(() => Boolean(slots.header));
const hasFooter = computed(() => Boolean(slots.footer));
</script>

<template>
    <div class="rounded-card border border-border bg-surface">
        <div
            v-if="hasHeader"
            class="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-fg">
            <slot name="header" />
        </div>
        <div class="px-4 py-3">
            <slot />
        </div>
        <div v-if="hasFooter" class="border-t border-border px-4 py-3">
            <slot name="footer" />
        </div>
    </div>
</template>
