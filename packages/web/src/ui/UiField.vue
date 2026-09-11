<script setup lang="ts">
interface Props {
    label?: string;
    for?: string;
    descriptionId?: string;
    required?: boolean;
    error?: string;
    hint?: string;
}

withDefaults(defineProps<Props>(), {
    label: "",
    for: undefined,
    descriptionId: undefined,
    required: false,
    error: "",
    hint: "",
});
</script>

<template>
    <div class="flex flex-col gap-1.5">
        <label v-if="label && $props.for" :for="$props.for" class="text-sm font-medium text-fg">
            {{ label }}
            <span v-if="required" class="text-danger" aria-hidden="true">*</span>
        </label>
        <div v-else-if="label" class="text-sm font-medium text-fg">
            {{ label }}
            <span v-if="required" class="text-danger" aria-hidden="true">*</span>
        </div>
        <slot />
        <p v-if="error" :id="descriptionId" role="alert" class="text-xs text-danger">
            {{ error }}
        </p>
        <p v-else-if="hint" :id="descriptionId" class="text-xs text-fg-tertiary">{{ hint }}</p>
    </div>
</template>
