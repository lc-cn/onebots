# 配置解释
| key       | type   | description                                     | default |
|:----------|:-------|:------------------------------------------------|:--------|
| port      | number | app监听端口                                         | 6727    |
| path      | string | app基础路径                                         |         |
| platform  | number | 机器人登录平台                                         | 5       |
| log_level | string | 日志输出等级                                          | info    |
| general   | object | 不同版本的onebot默认配置键值对，key为onebot版本，value为对应版本的默认配置 | 参阅源码    |
| [version] | object | 对应onebot版本的配置                                   |         |
