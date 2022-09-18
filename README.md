<div align="center">
    <h1>基于icqq的oneBot实现</h1>
    <p>

[![dm](https://shields.io/npm/dm/icqq-onebot)](https://www.npmjs.com/package/icqq-onebot)
[![oneBot V11](https://img.shields.io/badge/OneBot-11-black?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAMAAADxPgR5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAxQTFRF////29vbr6+vAAAAk1hCcwAAAAR0Uk5T////AEAqqfQAAAKcSURBVHja7NrbctswDATQXfD//zlpO7FlmwAWIOnOtNaTM5JwDMa8E+PNFz7g3waJ24fviyDPgfhz8fHP39cBcBL9KoJbQUxjA2iYqHL3FAnvzhL4GtVNUcoSZe6eSHizBcK5LL7dBr2AUZlev1ARRHCljzRALIEog6H3U6bCIyqIZdAT0eBuJYaGiJaHSjmkYIZd+qSGWAQnIaz2OArVnX6vrItQvbhZJtVGB5qX9wKqCMkb9W7aexfCO/rwQRBzsDIsYx4AOz0nhAtWu7bqkEQBO0Pr+Ftjt5fFCUEbm0Sbgdu8WSgJ5NgH2iu46R/o1UcBXJsFusWF/QUaz3RwJMEgngfaGGdSxJkE/Yg4lOBryBiMwvAhZrVMUUvwqU7F05b5WLaUIN4M4hRocQQRnEedgsn7TZB3UCpRrIJwQfqvGwsg18EnI2uSVNC8t+0QmMXogvbPg/xk+Mnw/6kW/rraUlvqgmFreAA09xW5t0AFlHrQZ3CsgvZm0FbHNKyBmheBKIF2cCA8A600aHPmFtRB1XvMsJAiza7LpPog0UJwccKdzw8rdf8MyN2ePYF896LC5hTzdZqxb6VNXInaupARLDNBWgI8spq4T0Qb5H4vWfPmHo8OyB1ito+AysNNz0oglj1U955sjUN9d41LnrX2D/u7eRwxyOaOpfyevCWbTgDEoilsOnu7zsKhjRCsnD/QzhdkYLBLXjiK4f3UWmcx2M7PO21CKVTH84638NTplt6JIQH0ZwCNuiWAfvuLhdrcOYPVO9eW3A67l7hZtgaY9GZo9AFc6cryjoeFBIWeU+npnk/nLE0OxCHL1eQsc1IciehjpJv5mqCsjeopaH6r15/MrxNnVhu7tmcslay2gO2Z1QfcfX0JMACG41/u0RrI9QAAAABJRU5ErkJggg==)](https://onebot.dev/)
[![oneBot V12](https://img.shields.io/badge/OneBot-12-black?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAMAAADxPgR5AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAAxQTFRF////29vbr6+vAAAAk1hCcwAAAAR0Uk5T////AEAqqfQAAAKcSURBVHja7NrbctswDATQXfD//zlpO7FlmwAWIOnOtNaTM5JwDMa8E+PNFz7g3waJ24fviyDPgfhz8fHP39cBcBL9KoJbQUxjA2iYqHL3FAnvzhL4GtVNUcoSZe6eSHizBcK5LL7dBr2AUZlev1ARRHCljzRALIEog6H3U6bCIyqIZdAT0eBuJYaGiJaHSjmkYIZd+qSGWAQnIaz2OArVnX6vrItQvbhZJtVGB5qX9wKqCMkb9W7aexfCO/rwQRBzsDIsYx4AOz0nhAtWu7bqkEQBO0Pr+Ftjt5fFCUEbm0Sbgdu8WSgJ5NgH2iu46R/o1UcBXJsFusWF/QUaz3RwJMEgngfaGGdSxJkE/Yg4lOBryBiMwvAhZrVMUUvwqU7F05b5WLaUIN4M4hRocQQRnEedgsn7TZB3UCpRrIJwQfqvGwsg18EnI2uSVNC8t+0QmMXogvbPg/xk+Mnw/6kW/rraUlvqgmFreAA09xW5t0AFlHrQZ3CsgvZm0FbHNKyBmheBKIF2cCA8A600aHPmFtRB1XvMsJAiza7LpPog0UJwccKdzw8rdf8MyN2ePYF896LC5hTzdZqxb6VNXInaupARLDNBWgI8spq4T0Qb5H4vWfPmHo8OyB1ito+AysNNz0oglj1U955sjUN9d41LnrX2D/u7eRwxyOaOpfyevCWbTgDEoilsOnu7zsKhjRCsnD/QzhdkYLBLXjiK4f3UWmcx2M7PO21CKVTH84638NTplt6JIQH0ZwCNuiWAfvuLhdrcOYPVO9eW3A67l7hZtgaY9GZo9AFc6cryjoeFBIWeU+npnk/nLE0OxCHL1eQsc1IciehjpJv5mqCsjeopaH6r15/MrxNnVhu7tmcslay2gO2Z1QfcfX0JMACG41/u0RrI9QAAAABJRU5ErkJggg==)](https://12.onebot.dev/)
[![node engine](https://img.shields.io/node/v/oitq?color=339933&style=flat-square&labelColor=FAFAFA&logo=Node.js)](https://nodejs.org)
[![qq group](https://img.shields.io/badge/group-860669870-blue?style=flat-square&labelColor=FAFAFA&logo=data:image/png;base64,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&logoColor=000000)](https://jq.qq.com/?_wv=1027&k=B22VGXov)

[Type Docs](/docs) 


</p>
</div>

# 使用示例
1. 新建一个node项目
```shell
npm init -y
```
2. 安装onebots
```shell
npm install onebots
```
3. 在项目跟目录添加配置文件config.yaml
```yaml
port: 6727 # 项目icqq-oneBot监听的端口(默认：6727)
1472258369: # 你的机器人账户
  version: V11 # oneBot版本（V11 或 V12）
```
4. 新建入口文件`index.js`并输入一下内容
```javascript
const {createApp}=require('onebots')
createApp()
.start()
```
5. 启动项目
```shell
node ./index.js
```
# 使用命令行启动
```shell
npm install -g onebots
onebots
```
# 使用接口管理oneBot

| url     | method | params           | desc                  |
|:--------| :--- |:-----------------|:----------------------|
| /list   | GET |                  | 获取当前运行的机器人列表          |
| /detail | GET | uin              | 获取指定机器人配置             |
| /qrcode | GET | uin              | 获取指定机器人登录二维码          |
| /add    | POST | {uin,...config}  | 添加机器人 config 为机器人配置   |
| /edit   | POST | {uin,...config}  | 修改机器人配置 config 为机器人配置 |
| /remove | get | uin | 移除机器人                 |

# 鸣谢
1. [icqqjs/icqq](https://github.com/takayama-lily/icqq) 底层服务支持
2. [takayama-lily/onebot](https://github.com/takayama-lily/node-onebot) oneBots原先版本
