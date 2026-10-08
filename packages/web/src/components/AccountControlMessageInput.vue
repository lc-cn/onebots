<script setup lang="ts">
import { ref } from "vue";

defineProps<{ modelValue: string; disabled: boolean; placeholder: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string]; send: [] }>();
const input = ref<HTMLTextAreaElement>();
const composing = ref(false);

function onKeydown(event: KeyboardEvent) {
    // 确认输入法候选词不是发送；生命周期也保护未携带 isComposing 的键盘事件。
    if (
        composing.value ||
        event.isComposing ||
        event.key !== "Enter" ||
        !(event.ctrlKey || event.metaKey)
    )
        return;
    event.preventDefault();
    emit("send");
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
    <textarea
        id="account-control-input"
        ref="input"
        :value="modelValue"
        name="message"
        autocomplete="off"
        rows="3"
        maxlength="32768"
        :disabled="disabled"
        :placeholder="placeholder"
        @input="emit('update:modelValue', input?.value ?? '')"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @blur="composing = false"
        @keydown="onKeydown"></textarea>
</template>
