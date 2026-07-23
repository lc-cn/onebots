<script setup lang='ts'>
import { useSlots, computed } from 'vue';

const slots = useSlots();
const hasContent = computed(() => Boolean(slots.default));
</script>

<template>
    <div
        v-if="hasContent"
        role="separator"
        class="flex items-center gap-3 text-xs text-fg-tertiary select-none">
        <span class="h-px flex-1 bg-border" aria-hidden="true" />
        <slot />
        <span class="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
    <hr v-else role="separator" class="border-t border-border" />
</template>
