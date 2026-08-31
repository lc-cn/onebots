#!/bin/bash
# 批量测试所有协议的 WebSocket 连接

PLATFORM=${1:-kook}
ACCOUNT_ID=${2:-zhin}

echo "=========================================="
echo "WebSocket 连接测试 - 批量测试"
echo "=========================================="
echo "平台: $PLATFORM"
echo "账号: $ACCOUNT_ID"
echo ""

# 测试 OneBot V11
echo "测试 OneBot V11..."
node test-ws.js $PLATFORM $ACCOUNT_ID onebot v11
sleep 2

# 测试 OneBot V12
echo "测试 OneBot V12..."
node test-ws.js $PLATFORM $ACCOUNT_ID onebot v12
sleep 2

# 测试 Milky V1
echo "测试 Milky V1..."
node test-ws.js $PLATFORM $ACCOUNT_ID milky v1
sleep 2

echo ""
echo "=========================================="
echo "所有测试完成"
echo "=========================================="

