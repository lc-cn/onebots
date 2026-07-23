<script setup lang='ts'>
import { provide, toRef } from 'vue';
import { collapseContextKey } from './collapseContext.js';

interface Props {
    /** 激活项 name 数组 */
    modelValue: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
    'update:modelValue': [names: string[]];
}>();

const activeNames = toRef(props, 'modelValue');

function toggle(name: string) {
    const next = activeNames.value.includes(name)
        ? activeNames.value.filter(n => n !== name)
        : [...activeNames.value, name];
    emit('update:modelValue', next);
}

provide(collapseContextKey, { activeNames, toggle });
</script>

<template>
    <div class="border-t border-border">
        <slot />
    </div>
</template>
