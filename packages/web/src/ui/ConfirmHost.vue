<script setup lang="ts">
import { computed } from "vue";
import UiModal from "./UiModal.vue";
import UiButton from "./UiButton.vue";
import { confirmState, resolveConfirm } from "./confirm";

const visible = computed({
    get: () => confirmState.visible,
    set: value => {
        if (!value) {
            // 遮罩点击 / Esc / 关闭按钮 均视为取消
            resolveConfirm(false);
        }
    },
});
</script>

<template>
    <UiModal v-model="visible" :title="confirmState.title" width="400px">
        <p v-if="confirmState.message" class="text-sm text-fg-secondary">
            {{ confirmState.message }}
        </p>
        <template #footer>
            <UiButton variant="secondary" @click="resolveConfirm(false)">
                {{ confirmState.cancelText }}
            </UiButton>
            <UiButton
                :variant="confirmState.danger ? 'danger' : 'primary'"
                @click="resolveConfirm(true)">
                {{ confirmState.confirmText }}
            </UiButton>
        </template>
    </UiModal>
</template>
