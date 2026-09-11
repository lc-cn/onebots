<script setup lang="ts">
import type { ControlUpdatePlan } from "@onebots/core/control";
import UiButton from "../ui/UiButton.vue";
defineProps<{ preview: ControlUpdatePlan; busy: boolean }>();
defineEmits<{ leave: [] }>();
</script>
<template>
    <section class="border border-border rounded-panel p-4 space-y-3" aria-live="polite">
        <h3 class="font-medium">
            {{ preview.state === "current" ? "当前网关已是最新发布组合" : "可升级的网关运行版本" }}
        </h3>
        <p class="text-sm text-fg-secondary">
            使用已安装的完整依赖清单，包括尚未启用的扩展；不修改账号或协议配置。
        </p>
        <div class="overflow-x-auto">
            <table class="update-comparison w-full text-left text-sm">
                <thead>
                    <tr>
                        <th scope="col" class="py-2">依赖</th>
                        <th scope="col">当前版本</th>
                        <th scope="col">目标版本</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in preview.packages" :key="item.name">
                        <td class="py-1 pr-4 break-all">{{ item.name }}</td>
                        <td class="pr-4">{{ item.current ?? "未安装" }}</td>
                        <td><span :class="{ 'version-change': item.current !== item.target }">{{ item.target }}</span></td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="preview.peers.length" class="text-xs text-fg-muted">
            对等依赖显示的是要求范围，实际解析版本由安装锁文件确定。
        </p>
        <UiButton :disabled="busy" @click="$emit('leave')">返回依赖选择</UiButton>
    </section>
</template>
