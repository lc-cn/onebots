<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import QRCode from "qrcode";
const props = defineProps<{ content: string; alt?: string }>();
const image = ref("");
const error = ref("");
let revision = 0;
watch(
    () => props.content,
    async content => {
        const current = ++revision;
        image.value = "";
        error.value = "";
        if (new TextEncoder().encode(content).length > 2048) {
            error.value = "二维码内容过长，请使用下方文本或验证链接。";
            return;
        }
        try {
            const result = await QRCode.toDataURL(content, {
                width: 280,
                margin: 4,
                errorCorrectionLevel: "M",
            });
            if (current === revision) image.value = result;
        } catch {
            if (current === revision) error.value = "无法生成二维码，请使用下方文本或验证链接。";
        }
    },
    { immediate: true },
);
onUnmounted(() => {
    revision++;
    image.value = "";
});
</script>
<template>
    <img
        v-if="image"
        :src="image"
        :alt="alt || '使用平台应用扫描二维码'"
        width="280"
        height="280"
        class="h-auto max-w-full" />
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
</template>
