<script setup lang="ts">
import { getCurrentInstance } from "vue";
import { IconCheck, IconChevronRight } from "@tabler/icons-vue";
import type { SetupJourney } from "../control-product-state.js";
import type { Workspace } from "../control-workspace.js";
import UiButton from "../ui/UiButton.vue";

const props = defineProps<{ journey: SetupJourney; compact?: boolean }>();
const emit = defineEmits<{ select: [workspace: Workspace] }>();
const headingId = `setup-journey-${getCurrentInstance()?.uid ?? "unknown"}`;

const descriptions: Record<
    SetupJourney["state"],
    { eyebrow: string; title: string; body: string }
> = {
    loading: {
        eyebrow: "正在读取工作区",
        title: "确认当前设置进度",
        body: "正在读取已安装扩展、配置和网关状态。",
    },
    unavailable: {
        eyebrow: "工作区信息不可用",
        title: "暂时无法判断下一步",
        body: "请先恢复管理服务连接。已有配置不会被自动覆盖。",
    },
    "needs-extensions": {
        eyebrow: "第一步",
        title: "选择要接入的平台和输出协议",
        body: "先查看平台能力与凭据要求，再选择框架兼容扩展。确认完整方案后才会安装。",
    },
    "needs-configuration": {
        eyebrow: "第二步",
        title: "配置账号和连接参数",
        body: "扩展已经就绪。填写平台凭据与协议连接参数，校验通过后再应用。",
    },
    "ready-to-start": {
        eyebrow: "第三步",
        title: "配置已就绪，可以启动网关",
        body: "启动后根据平台提示完成登录验证，并在运行与诊断中检查连接结果。",
    },
    recovery: {
        eyebrow: "需要人工恢复",
        title: "先核对上一项网关操作",
        body: "当前结果无法安全确认。请查看原操作与服务日志，完成对账后再启动或修改运行版本。",
    },
    running: {
        eyebrow: "设置完成",
        title: "网关正在提供服务",
        body: "平台账号、输出协议和运行状态都可以继续独立管理。",
    },
};
</script>

<template>
    <section
        class="setup-journey"
        :class="{ compact, complete: journey.state === 'running' }"
        :aria-labelledby="headingId">
        <div class="setup-journey-copy">
            <p class="eyebrow">{{ descriptions[journey.state].eyebrow }}</p>
            <h2 :id="headingId">{{ descriptions[journey.state].title }}</h2>
            <p>{{ descriptions[journey.state].body }}</p>
            <UiButton
                v-if="journey.state !== 'loading' && journey.state !== 'unavailable'"
                variant="primary"
                @click="emit('select', journey.nextWorkspace)">
                {{ journey.nextLabel }}
                <IconChevronRight :size="16" aria-hidden="true" />
            </UiButton>
        </div>
        <ol class="setup-journey-steps">
            <li v-for="(step, index) in journey.steps" :key="step.id" :class="step.status">
                <span class="setup-step-mark" aria-hidden="true">
                    <IconCheck v-if="step.status === 'complete'" :size="15" />
                    <template v-else>{{ index + 1 }}</template>
                </span>
                <span>
                    <strong>{{ step.label }}</strong>
                    <small>{{ step.detail }}</small>
                </span>
            </li>
        </ol>
    </section>
</template>
