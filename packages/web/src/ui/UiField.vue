<script setup lang="ts">
interface Props {
    label?: string;
    required?: boolean;
    error?: string;
    hint?: string;
}

withDefaults(defineProps<Props>(), {
    label: '',
    required: false,
    error: '',
    hint: ''
});
</script>

<template>
    <div class="flex flex-col gap-1.5">
        <label v-if="label" class="text-sm font-medium text-fg">
            {{ label }}
            <span v-if="required" class="text-danger">*</span>
        </label>
        <slot />
        <p v-if="error" class="text-xs text-danger">{{ error }}</p>
        <p v-else-if="hint" class="text-xs text-fg-tertiary">{{ hint }}</p>
    </div>
</template>
