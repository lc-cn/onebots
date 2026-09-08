# Windows 原生管理服务安装须待平台驱动与恢复验收完成。
# 不能继续调用旧 setup/update 流程，也不能先下载或改写用户的运行目录。
$ErrorActionPreference = "Stop"
Write-Host "[OneBots] 当前服务架构尚不支持 Windows 原生托管安装。"
Write-Host "[OneBots] 请使用 Docker Desktop，并按文档挂载 /data 持久化目录。"
Write-Host "[OneBots] 未下载程序、修改配置、安装服务或读取凭据。"
Write-Host "[OneBots] 部署说明：https://onebots.pages.dev/guide/docker"
exit 1
