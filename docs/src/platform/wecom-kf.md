# 微信客服适配器

企业微信 **微信客服**（非自建应用消息）接入说明。实现细节、配置与常见错误码以包内 README 为准：

- 源码与文档：[`@onebots/adapter-wecom-kf`](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom-kf)
- 官方概述：[微信客服 - 概述](https://developer.work.weixin.qq.com/document/path/94638)

## 与应用消息适配器（wecom）的区别

| 项目 | `adapter-wecom` | `adapter-wecom-kf` |
|------|-----------------|---------------------|
| 平台 ID / `-r` | `wecom` | `wecom-kf` |
| 主 API | `message/send` 应用消息 | `kf/sync_msg`、`kf/send_msg` |
| 典型场景 | 员工工作台应用消息 | 微信内客服进线、API 托管会话 |

两者可同时安装，配置段分别为 `wecom.*` 与 `wecom-kf.*`。

## 快速配置

参阅适配器 README 中的 `config.yaml` 示例与回调 URL 格式。

```bash
onebots -r wecom-kf -p onebot-v11 -c config.yaml
```

## 参考文档

- [接收消息和事件](https://developer.work.weixin.qq.com/document/path/94670)
- [发送消息](https://developer.work.weixin.qq.com/document/path/94677)
- [获取会话状态 / 变更会话状态](https://developer.work.weixin.qq.com/document/path/94669)
