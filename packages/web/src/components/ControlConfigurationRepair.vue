<script setup lang="ts">
import { ref, watch } from "vue";
import UiButton from "../ui/UiButton.vue";
import type { ConfigurationSource } from "./control-configuration-source.js";
const props = defineProps<{ source: ConfigurationSource; disabled: boolean }>();
const emit = defineEmits<{ confirm: [confirmed: boolean] }>();
const confirmed = ref(false);
watch(
    () => [props.source.base.configRevision, props.source.base.generationId],
    () => {
        confirmed.value = false;
    },
);
function submit() {
    if (!confirmed.value || props.disabled) return;
    emit("confirm", true);
    confirmed.value = false;
}
</script>
<template>
    <div role="alert" class="rounded-xl border border-border p-4 space-y-3">
        <h3 class="font-medium">运行配置无法解析</h3>
        <p class="text-sm text-fg-secondary">
            原文件不会显示或被当作空配置。修复将先保存原文件的私有备份，再建立新的配置草稿；仍需自行编辑、校验并应用。
        </p>
        <label class="flex gap-2 text-sm">
            <input
                v-model="confirmed"
                type="checkbox"
                :disabled="disabled || !source.repairAvailable" />
            保留原文件私有备份，重新建立配置
        </label>
        <UiButton :disabled="disabled || !source.repairAvailable || !confirmed" @click="submit"
            >创建修复草稿</UiButton
        >
        <p v-if="!source.repairAvailable" class="text-sm text-fg-secondary">
            当前暂不能安全修复，请检查本地工作区状态。
        </p>
    </div>
</template>
