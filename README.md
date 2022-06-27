# oicq-oneBot
<div align="center">
    <p>基于oicq的oneBot实现</p>
    <p>

[docs](/docs)

</p>
</div>

# 使用示例
1. 新建一个node项目
```shell
npm init -y
```
2. 安装oicq-oneBot
```shell
npm install oicq-onebot
```
3. 在项目跟目录添加配置文件config.yaml
```yaml
port: 6727 # 项目oicq-oneBot监听的端口(默认：6727)
bots:
  1472258369: # 你的机器人账户
    version: V11 # oneBot版本（V11 或 V12）
```
4. 新建入口文件`index.js`并输入一下内容
```javascript
const {createApp}=require('oicq-onebot')
createApp()
.start()
```
5. 启动项目
```shell
node ./index.js
```
# 鸣谢
1. [takayama-lily/oicq](https://github.com/takayama-lily/oicq) 底层服务支持
2. [takayama-lili/onebot](https://github.com/takayama-lily/node-onebot) oicq的oneBot原先版本
