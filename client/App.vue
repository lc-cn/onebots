<template>
    <div class="OneBots">
        <section class="config">
            <h2>配置
                <span class="buttons">
                    <button @click="reloadConfig">重载配置</button>
                    <button @click="saveConfig">保存</button>
                </span>
            </h2>
            <textarea v-model="config"></textarea>
        </section>
        <section class="adapters">
            <h2>详情</h2>
            <ul>
                <li v-for="adapter of adapters" :key="adapter.platform">
                    <p>所属平台：{{ adapter.platform }}</p>
                    <ul>
                        <li v-for="bot of adapter.bots" :key="bot.uin">
                            <p>账号：{{ bot.uin }}</p>
                            <p>状态：{{ bot.status }}</p>
                            <p>URL：{{ bot.urls }}</p>
                        </li>
                    </ul>
                </li>
            </ul>
        </section>
        <section class="logs">
            <h2>日志</h2>
            <pre>{{logs}}</pre>
            <div class="input-wrapper">
                <span class="text">{{inputData}}</span>
                <input v-model="inputData" @keyup.enter="submitInput">
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { AdapterInfo } from "./types";

const ws = ref<WebSocket>();
const config = ref<string>('');
const adapters = ref<AdapterInfo[]>([]);
const logs = ref<string>('');
const inputData = ref("");
const scrollToBottom=()=>{
    nextTick(() => {
        const logDom = document.querySelector(".OneBots>.logs>pre");
        const height = logDom.scrollHeight;
        logDom.scrollTo({
            top: height,
            behavior: "smooth"
        });

    });
}
const initLog = (receive: string) => {
    logs.value = receive;
    scrollToBottom()
};
const reloadConfig=()=>{
    ws.value.send(JSON.stringify({
        action:'system.reload',
        data:null
    }))
}
const saveConfig=()=>{
    ws.value.send(JSON.stringify({
        action:'system.saveConfig',
        data:config.value
    }))
}
const dispatch = (event: string, data: any) => {
    switch (event) {
        case "system.sync":
            console.log(data);
            config.value = data.config;
            adapters.value = data.adapters;
            initLog(data.logs);
            break;
        case "system.log":
            initLog(data);
    }
};
const init = () => {
    const port = localStorage.getItem("OneBots:serverPort") || prompt("请输入服务端监听的端口号", location.port);
    const wsUrl = `ws://${location.hostname}:${port}`;
    ws.value = new WebSocket(wsUrl);
    ws.value.onerror = (e) => {
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
    ws.value.send(JSON.stringify({
        action:'system.input',
        data:inputData.value
    }))
    logs.value+=`\n+${inputData.value}`
    scrollToBottom()
    inputData.value=''
};
onMounted(init);
</script>

<style lang="scss" scoped>
.OneBots {
    display: flex;

    section {
        height: 95vh;
        overflow: auto;

        &.config {
            min-width: 400px;
            display: flex;
            flex-direction: column;
            h2{
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-right: 20px;

                .buttons{
                    display: flex;
                    gap:4px;
                    button{
                        background-color: #ffffff;
                        outline: none;
                        cursor: pointer;
                        border: 1px solid #e1e1e1;
                        border-radius: 4px;
                        color: #1a1a18;
                        font-size: 14px;
                        font-weight: 500;
                        padding:2px 10px;
                    }
                }
            }
            textarea{
                flex: auto;
                resize: none;
            }
        }

        &.adapters {
            min-width: 300px;
        }

        &.logs {
            flex: auto;
            display: flex;
            flex-direction: column;
            pre {
                box-sizing: border-box;
                margin: 0;
                word-break: break-all;
                white-space: pre-wrap;
                padding: 6px;
                list-style: none;
                flex: auto;
                overflow: auto;
                background-color: black;
                color: white;
            }

            .input-wrapper{
                position: relative;
                background-color: black;
                padding: 0 6px;
                height: 22px;
                box-sizing: border-box;
                .text{
                    color: rgba(0,0,0,0);
                    z-index: 1;
                    position: absolute;
                    pointer-events: none;
                    display: inline-flex;
                    width: 100%;
                    height: 100%;
                    left: 6px;
                    top: 0;
                    &::after {
                        content: ' ';
                        display: block;
                        height: 100%;
                        width: 5px;
                        z-index: 1;
                        background-color: white;
                        animation: pointer 1s infinite steps(1,start);
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
                    &:focus{
                        outline: none;
                        caret-color: transparent;
                    }
                }
            }
        }

        h2 {
            position: sticky;
            margin-block-start: 0;
            background-color: aliceblue;
            top: 0;
        }
    }
}

@keyframes pointer {
    0%,100% {
        opacity: 0;
    }
    50%{
        opacity: 1;
    }
}
</style>
