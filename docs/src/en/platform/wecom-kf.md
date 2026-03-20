# WeCom Customer Service (WeChat 客服)

This adapter connects **WeChat Customer Service** APIs (`kf/sync_msg`, `kf/send_msg`), not the standard WeCom **app message** APIs. See the Chinese documentation for full setup (callback URL, `open_kfid`, caveats):

- [微信客服 wecom-kf (中文)](/platform/wecom-kf)
- [Official overview](https://developer.work.weixin.qq.com/document/path/94638)
- Package: [`@onebots/adapter-wecom-kf`](https://github.com/lc-cn/onebots/tree/master/adapters/adapter-wecom-kf)

```bash
onebots -r wecom-kf -p onebot-v11 -c config.yaml
```
