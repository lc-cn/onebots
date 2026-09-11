<script setup lang="ts">
import type { ControlSystemStatus } from "@onebots/core/control";
import { IconCpu, IconDatabase, IconDeviceDesktop, IconServer } from "@tabler/icons-vue";
import { formatBytes, formatUptime, resourcePercent } from "../system-format.js";

defineProps<{ system?: ControlSystemStatus }>();
</script>

<template>
    <section class="system-overview" aria-labelledby="system-title">
        <div class="section-heading">
            <div>
                <h2 id="system-title">运行环境与资源</h2>
                <p>管理服务所在设备 · 随状态自动刷新</p>
            </div>
            <span v-if="system" class="system-sample"
                >{{ new Date(system.sampledAt).toLocaleTimeString() }} 采样</span
            >
        </div>
        <p v-if="!system" class="system-unavailable">
            暂未获取资源信息，可能是管理服务版本较旧或运行环境限制了系统信息读取。
        </p>
        <template v-else>
            <div class="system-grid">
                <article class="system-card" style="--resource-color: var(--accent)">
                    <h3><IconServer :size="20" aria-hidden="true" />运行环境</h3>
                    <div class="system-value">
                        Node.js <strong>{{ system.nodeVersion }}</strong>
                    </div>
                    <dl>
                        <div>
                            <dt>操作系统</dt>
                            <dd>{{ system.platform }} · {{ system.arch }}</dd>
                        </div>
                        <div>
                            <dt>内核版本</dt>
                            <dd>{{ system.release }}</dd>
                        </div>
                        <div>
                            <dt>管理服务已运行</dt>
                            <dd>{{ formatUptime(system.managerUptimeSeconds) }}</dd>
                        </div>
                    </dl>
                </article>
                <article class="system-card" style="--resource-color: var(--info)">
                    <h3><IconDeviceDesktop :size="20" aria-hidden="true" />设备信息</h3>
                    <div class="system-value">
                        <strong>{{ system.hostname }}</strong>
                    </div>
                    <dl>
                        <div>
                            <dt>CPU</dt>
                            <dd>{{ system.cpuModel }}</dd>
                        </div>
                        <div>
                            <dt>逻辑处理器</dt>
                            <dd>{{ system.logicalCpus }} 个</dd>
                        </div>
                        <div>
                            <dt>系统已运行</dt>
                            <dd>{{ formatUptime(system.uptimeSeconds) }}</dd>
                        </div>
                    </dl>
                </article>
                <article class="system-card" style="--resource-color: var(--success)">
                    <h3><IconCpu :size="20" aria-hidden="true" />系统内存</h3>
                    <div class="system-value">
                        <strong>{{ formatBytes(system.memory.total - system.memory.free) }}</strong
                        ><span>/ {{ formatBytes(system.memory.total) }}</span>
                    </div>
                    <progress
                        :value="
                            resourcePercent(
                                system.memory.total - system.memory.free,
                                system.memory.total,
                            )
                        "
                        max="100"
                        aria-label="系统非空闲内存比例" />
                    <dl>
                        <div>
                            <dt>空闲内存</dt>
                            <dd>{{ formatBytes(system.memory.free) }}</dd>
                        </div>
                        <div>
                            <dt>管理进程 RSS</dt>
                            <dd>{{ formatBytes(system.memory.managerRss) }}</dd>
                        </div>
                        <div>
                            <dt>管理进程 JS 堆</dt>
                            <dd>
                                {{ formatBytes(system.memory.heapUsed) }} /
                                {{ formatBytes(system.memory.heapTotal) }}
                            </dd>
                        </div>
                    </dl>
                    <p class="system-note">非空闲量含系统缓存；进程数据不含网关。</p>
                </article>
                <article class="system-card" style="--resource-color: var(--warning)">
                    <h3><IconDatabase :size="20" aria-hidden="true" />工作区磁盘</h3>
                    <template v-if="system.disk.state === 'ready'">
                        <div class="system-value">
                            <strong>{{ formatBytes(system.disk.used) }}</strong
                            ><span>/ {{ formatBytes(system.disk.total) }}</span>
                        </div>
                        <progress
                            :value="resourcePercent(system.disk.used, system.disk.total)"
                            max="100"
                            aria-label="工作区所在文件系统已用比例" />
                        <dl>
                            <div>
                                <dt>可用空间</dt>
                                <dd>{{ formatBytes(system.disk.available) }}</dd>
                            </div>
                            <div>
                                <dt>容量更新</dt>
                                <dd>
                                    {{
                                        system.disk.sampledAt
                                            ? new Date(system.disk.sampledAt).toLocaleTimeString()
                                            : "—"
                                    }}
                                </dd>
                            </div>
                        </dl>
                        <p class="system-note">
                            所在文件系统容量，非 OneBots 文件大小。每 30 秒按需采样。
                        </p>
                    </template>
                    <p v-else class="system-unavailable">
                        {{
                            system.disk.state === "pending"
                                ? "正在读取磁盘容量…"
                                : "暂时无法读取磁盘容量，将自动重试。"
                        }}
                    </p>
                </article>
            </div>
            <p class="system-note">
                系统资源由操作系统报告；在 Docker 等隔离环境中，不等同于容器资源配额。
            </p>
        </template>
    </section>
</template>

<style scoped>
.system-overview {
    min-width: 0;
}
.section-heading p,
.system-sample,
.system-note {
    color: var(--fg-secondary);
    font-size: 0.75rem;
}
.section-heading p {
    margin-top: 0.35rem;
}
.system-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;
}
.system-card {
    min-width: 0;
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 1.25rem;
    background:
        linear-gradient(
            145deg,
            color-mix(in srgb, var(--resource-color) 7%, transparent),
            transparent 65%
        ),
        var(--surface);
    backdrop-filter: blur(18px);
    box-shadow: var(--shadow);
}
.system-card h3 {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
}
.system-card h3 svg {
    color: var(--resource-color);
}
.system-value {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    margin: 1rem 0;
    overflow-wrap: anywhere;
    font-size: 0.85rem;
}
.system-value strong {
    font-size: 1.3rem;
    font-weight: 650;
    letter-spacing: -0.035em;
}
.system-value span {
    color: var(--fg-secondary);
    font-size: 0.75rem;
}
dl {
    display: grid;
    gap: 0.65rem;
    margin: 1rem 0 0;
    font-size: 0.78rem;
}
dl > div {
    display: flex;
    gap: 0.8rem;
    justify-content: space-between;
    align-items: baseline;
}
dt {
    flex-shrink: 0;
    color: var(--fg-secondary);
}
dd {
    text-align: right;
    margin: 0;
    overflow-wrap: anywhere;
    min-width: 0;
}
progress {
    display: block;
    width: 100%;
    height: 0.4rem;
    border: 0;
    border-radius: 1rem;
    overflow: hidden;
    background: var(--border);
    appearance: none;
}
progress::-webkit-progress-bar {
    background: var(--border);
}
progress::-webkit-progress-value {
    background: var(--resource-color);
    border-radius: 1rem;
}
progress::-moz-progress-bar {
    background: var(--resource-color);
    border-radius: 1rem;
}
.system-note {
    margin-top: 0.85rem;
    line-height: 1.6;
}
.system-unavailable {
    padding: 1rem 0;
    color: var(--fg-secondary);
    font-size: 0.85rem;
}
@media (max-width: 1400px) {
    .system-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
@media (max-width: 700px) {
    .system-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    .system-sample {
        display: none;
    }
}
</style>
