<script setup lang="ts">
import { computed, getCurrentInstance, ref } from "vue";
import { IconHelpCircle } from "@tabler/icons-vue";

defineProps<{ label: string; text: string }>();

const id = `info-tip-${getCurrentInstance()!.uid}`;
const hovered = ref(false);
const focused = ref(false);
const pinned = ref(false);
const visible = computed(() => hovered.value || focused.value || pinned.value);

function close(event: KeyboardEvent) {
    pinned.value = false;
    hovered.value = false;
    focused.value = false;
    (event.currentTarget as HTMLElement).querySelector("button")?.blur();
}
</script>

<template>
    <span
        class="ui-info-tip"
        @pointerenter="hovered = true"
        @pointerleave="hovered = false"
        @focusin="focused = true"
        @focusout="focused = false"
        @keydown.esc="close">
        <button
            type="button"
            class="ui-info-tip-trigger"
            :aria-label="label"
            :aria-describedby="visible ? id : undefined"
            :aria-expanded="pinned"
            @click="pinned = !pinned">
            <IconHelpCircle :size="17" aria-hidden="true" />
        </button>
        <span v-if="visible" :id="id" class="ui-info-tip-content" role="tooltip">{{ text }}</span>
    </span>
</template>
