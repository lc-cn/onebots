# OneBotWithVersion\<T extends 'V11'|'V12'\>

| 字段名     | 类型 | 描述        | 默认值 |
|---------|----|-----------|-----|
| version | T  | OneBot 版本 | 必填  |
| ... | - | 对应OneBot的配置 | - |
## 例
```yaml
icqq.147258369:
  versions:
  - version: V11
    access_token: ''
    enable_http: false
    ws_reverse:
      - http://127.0.0.1:20001
  - version: V12
    access_token: ''
    enable_http: false
    webhook:
      - http://192.168.1.8:8080/onebot
      - http://192.168.1.9:8080/onebot
  protocol:
    # ... 其他适配器配置
```
