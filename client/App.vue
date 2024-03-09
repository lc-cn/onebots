<template>
    <el-row class="OneBots">
        <el-col :xs="24" :sm="10" :md="10" :xl="8" :lg="8" class="config">
            <textarea v-model="config"></textarea>
            <p>
                <el-button @click="reloadConfig" type="success">重载配置</el-button>
                <el-button @click="saveConfig" type="primary">保存</el-button>
            </p>
        </el-col>
        <el-col :xs="24" :sm="6" :md="6" :xl="6" :lg="6" class="bots">
            <template v-for="adapter of adapters">
                <el-card :key="`${bot.platform}:${bot.uin}`" v-for="bot of adapter.bots">
                    <div class="card-header">
                        <el-image
                            style="width: 30px; height: 30px"
                            :alt="bot.nickname"
                            fit="contain"
                            :src="bot.avatar" />
                        <span>{{ bot.nickname }}({{ bot.uin }})</span>
                        <el-button
                            type="primary"
                            @click="setOnline(adapter.platform, bot.uin)"
                            size="small"
                            v-if="bot.status === 'offline'"
                            >上线</el-button
                        >
                        <el-button
                            type="danger"
                            @click="setOffline(adapter.platform, bot.uin)"
                            size="small"
                            v-if="bot.status === 'online'"
                            >下线</el-button
                        >
                    </div>
                    <p>
                        状态：
                        <el-tag type="success" v-if="bot.status === 'online'">在线</el-tag>
                        <el-tag v-else-if="bot.status === 'pending'" type="warning">上线中</el-tag>
                        <el-tag type="danger" v-else-if="bot.status === 'offline'">离线</el-tag>
                    </p>
                    <p>
                        所属平台：
                        <el-image
                            style="width: 30px; height: 30px"
                            :alt="adapter.platform"
                            fit="contain"
                            :src="adapter.icon" />
                        {{ adapter.platform }}
                    </p>
                    <p>依赖：{{ bot.dependency }}</p>
                    <p v-for="url in bot.urls" :key="url">
                        <el-link :href="href(url)" type="primary">{{ url }}</el-link>
                    </p>
                </el-card>
            </template>
        </el-col>
        <el-col :xs="24" :sm="8" :md="8" :xl="10" :lg="10" class="logs">
            <el-descriptions title="系统信息">
                <el-descriptions-item label="用户名">
                    {{ systemInfo.username }}
                </el-descriptions-item>
                <el-descriptions-item label="内核">
                    {{ systemInfo.system_platform }}
                </el-descriptions-item>
                <el-descriptions-item label="架构">
                    {{ systemInfo.system_arch }}
                </el-descriptions-item>
                <el-descriptions-item label="开机时长">
                    {{ formatTime(systemInfo.system_uptime) }}
                </el-descriptions-item>
                <el-descriptions-item label="内存">
                    {{ formatSize(systemInfo.free_memory) }}/{{
                        formatSize(systemInfo.total_memory)
                    }}
                </el-descriptions-item>
                <el-descriptions-item label="Node版本">
                    {{ systemInfo.node_version }}
                </el-descriptions-item>
                <el-descriptions-item label="SDK">
                    onebots v{{ systemInfo.sdk_version }}
                </el-descriptions-item>
                <el-descriptions-item label="运行目录">
                    {{ systemInfo.process_cwd }}
                </el-descriptions-item>
                <el-descriptions-item label="PID">
                    {{ systemInfo.process_id }}
                </el-descriptions-item>
                <el-descriptions-item label="PPID">
                    {{ systemInfo.process_parent_id }}
                </el-descriptions-item>
                <el-descriptions-item label="运行时长">
                    {{ formatTime(systemInfo.uptime) }}
                </el-descriptions-item>
                <el-descriptions-item label="占用">
                    {{ formatSize(systemInfo.process_use_memory) }}
                </el-descriptions-item>
                {{ systemInfo }}
            </el-descriptions>
            <pre @click="input?.focus?.()">{{ logs }}</pre>
            <div class="input-wrapper">
                <span class="text">{{ inputData }}</span>
                <input ref="input" v-model="inputData" @keyup.enter="submitInput" />
            </div>
        </el-col>
    </el-row>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { AdapterInfo, SystemInfo } from "./types";
import { formatSize, formatTime } from "./utils";
const input = ref();
const ws = ref<WebSocket>();
const config = ref<string>("");
const adapters = ref<AdapterInfo[]>([]);
const logs = ref<string>("");
const systemInfo = ref<SystemInfo>({
    free_memory: 0,
    node_version: "",
    process_cwd: "",
    process_id: 0,
    process_parent_id: 0,
    process_use_memory: 0,
    sdk_version: "",
    uptime: 0,
    system_arch: "",
    system_cpus: [],
    system_platform: "",
    system_uptime: 0,
    system_version: "",
    total_memory: 0,
    username: "",
});
const href = (url: string) =>
    `${location.protocol}//${location.hostname}:${localStorage.getItem(
        "OneBots:serverPort",
    )}${url}`;
const inputData = ref("");
const timer = ref();
const startTimer = () => {
    timer.value = setInterval(() => {
        systemInfo.value.uptime += 1000;
        systemInfo.value.system_uptime += 1000;
    }, 1000);
};
const setOnline = (platform: string, uin: string) => {
    ws.value.send(
        JSON.stringify({
            action: "bot.start",
            data: JSON.stringify({
                platform,
                uin,
            }),
        }),
    );
};
const setOffline = (platform: string, uin: string) => {
    ws.value.send(
        JSON.stringify({
            action: "bot.stop",
            data: JSON.stringify({
                platform,
                uin,
            }),
        }),
    );
};
const scrollToBottom = () => {
    nextTick(() => {
        const logDom = document.querySelector(".OneBots>.logs>pre");
        const height = logDom.scrollHeight;
        logDom.scrollTo({
            top: height,
            behavior: "smooth",
        });
        nextTick(() => {
            input.value?.focus();
        });
    });
};
const initLog = (receive: string) => {
    logs.value = receive;
    scrollToBottom();
};
const addLog = (line: string) => {
    logs.value += line + "\n";
    scrollToBottom();
};
const reloadConfig = () => {
    ws.value.send(
        JSON.stringify({
            action: "system.reload",
            data: null,
        }),
    );
};
const saveConfig = () => {
    ws.value.send(
        JSON.stringify({
            action: "system.saveConfig",
            data: config.value,
        }),
    );
};
const dispatch = (event: string, data: any) => {
    switch (event) {
        case "system.sync":
            config.value = data.config;
            adapters.value = data.adapters;
            systemInfo.value = data.app;
            startTimer();
            initLog(data.logs);
            break;
        case "bot.change": {
            const adapter = adapters.value.find(adapter => adapter.platform === data.platform);
            if (!adapter) return;
            const botIdx = adapter.bots.findIndex(bot => bot.uin === data.uin);
            if (botIdx === -1) return;
            adapter.bots[botIdx].status = data.status;
        }
        case "system.log":
            addLog(data);
    }
};
const init = () => {
    const port =
        localStorage.getItem("OneBots:serverPort") ||
        prompt("请输入服务端监听的端口号", location.port);
    const wsUrl = `${location.protocol.replace("http", "ws")}//${location.hostname}:${port}`;
    ws.value = new WebSocket(wsUrl);
    ws.value.onerror = e => {
        console.error("连接出错", e);
        localStorage.removeItem("OneBots:serverPort");
        init();
    };
    ws.value.onopen = () => {
        console.log("success connect to " + wsUrl);
        localStorage.setItem("OneBots:serverPort", port);
    };

    ws.value.onclose = e => {
        console.log("connect close", e);
    };
    ws.value.onmessage = (e: MessageEvent) => {
        const { event, data } = JSON.parse(e.data);
        dispatch(event, data);
    };
};
const submitInput = () => {
    ws.value.send(
        JSON.stringify({
            action: "system.input",
            data: inputData.value,
        }),
    );
    logs.value += `\n+${inputData.value}`;
    scrollToBottom();
    inputData.value = "";
};
onMounted(init);
onUnmounted(() => {
    clearInterval(timer?.value);
});
</script>

<style lang="scss" scoped>
.OneBots {
    display: flex;
    width: 100%;
    & > .el-col {
        overflow: auto;
        padding: 8px;
        &.config {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            .el-button {
                margin-top: 20px;
            }
            textarea {
                flex: auto;
                max-height: 800px;
                min-height: 600px;
                width: 100%;
                resize: none;
            }
        }

        &.bots {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 100vh;
            overflow: auto;
            .el-card {
                min-height: 250px;
                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                p {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    margin-block-start: 10px;
                    margin-block-end: 10px;
                }
            }
        }

        &.logs {
            display: flex;
            flex-direction: column;
            max-height: 100vh;
            .el-descriptions {
                height: 40vh;
                margin-bottom: 8px;
            }
            pre {
                box-sizing: border-box;
                margin: 0;
                word-break: break-all;
                white-space: pre-wrap;
                list-style: none;
                height: calc(60vh - 30px);
                overflow: auto;
                background-color: black;
                color: white;
            }

            .input-wrapper {
                position: relative;
                background-color: black;
                padding: 0 6px;
                height: 22px;
                box-sizing: border-box;
                .text {
                    color: rgba(0, 0, 0, 0);
                    z-index: 1;
                    position: absolute;
                    pointer-events: none;
                    display: inline-flex;
                    width: 100%;
                    height: 100%;
                    left: 6px;
                    top: 0;
                    &::after {
                        content: " ";
                        display: block;
                        height: 100%;
                        width: 5px;
                        z-index: 1;
                        background-color: white;
                        animation: pointer 1s infinite steps(1, start);
                    }
                }
                input {
                    border: 0;
                    display: inline-block;
                    background-color: transparent;
                    width: 100%;
                    color: white;
                    height: 22px;
                    padding: 0;
                    padding-block: 0;
                    padding-inline: 0;
                    margin: 0;
                    &:focus {
                        outline: none;
                        caret-color: transparent;
                    }
                }
            }
        }
    }
}

@keyframes pointer {
    0%,
    100% {
        opacity: 0;
    }
    50% {
        opacity: 1;
    }
}
</style>
