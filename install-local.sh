#!/bin/bash

# OpenCode 本地安装脚本
# 用于编译并安装到本地系统

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPencode_DIR="$SCRIPT_DIR/packages/opencode"
DIST_DIR="$OPencode_DIR/dist/opencode-darwin-arm64"
BINARY_PATH="$DIST_DIR/bin/opencode"

echo "🚀 OpenCode 本地安装脚本"
echo "=========================="
echo ""

# 检查 Bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun 未安装，请先安装 Bun:"
    echo "   npm install -g bun"
    exit 1
fi

echo "✅ Bun 已安装: $(bun --version)"
echo ""

# 步骤 1: 构建
echo "📦 步骤 1: 构建二进制文件..."
echo "   这可能需要几分钟时间，请耐心等待..."
cd "$OPencode_DIR"

if [ ! -f "$BINARY_PATH" ]; then
    echo "   开始构建..."
    bun run script/build.ts --single
else
    echo "   二进制文件已存在，跳过构建"
    echo "   如需重新构建，请删除: rm -rf $DIST_DIR"
fi

if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ 构建失败: 二进制文件不存在"
    exit 1
fi

echo "✅ 构建完成: $BINARY_PATH"
echo ""

# 步骤 2: 添加执行权限
echo "🔧 步骤 2: 设置执行权限..."
chmod +x "$BINARY_PATH"
echo "✅ 执行权限已设置"
echo ""

# 步骤 3: 选择安装方式
echo "📥 步骤 3: 选择安装方式"
echo ""
echo "1) 安装到 /usr/local/bin (需要 sudo)"
echo "2) 安装到 ~/.local/bin (推荐，不需要 sudo)"
echo "3) 创建别名到 ~/.zshrc"
echo "4) 仅显示使用方式，不安装"
echo ""
read -p "请选择 (1-4): " choice

case $choice in
    1)
        echo "   安装到 /usr/local/bin..."
        sudo ln -sf "$BINARY_PATH" /usr/local/bin/opencode
        echo "✅ 已安装到 /usr/local/bin/opencode"
        ;;
    2)
        echo "   安装到 ~/.local/bin..."
        mkdir -p ~/.local/bin
        ln -sf "$BINARY_PATH" ~/.local/bin/opencode
        
        # 检查 PATH
        if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
            echo "   添加 ~/.local/bin 到 PATH..."
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
            echo "✅ 已添加到 ~/.zshrc，请运行: source ~/.zshrc"
        fi
        echo "✅ 已安装到 ~/.local/bin/opencode"
        ;;
    3)
        echo "   创建别名..."
        if ! grep -q "alias opencode=" ~/.zshrc 2>/dev/null; then
            echo "alias opencode='$BINARY_PATH'" >> ~/.zshrc
            echo "✅ 别名已添加到 ~/.zshrc，请运行: source ~/.zshrc"
        else
            echo "⚠️  别名已存在，跳过"
        fi
        ;;
    4)
        echo "   跳过安装"
        ;;
    *)
        echo "❌ 无效选择"
        exit 1
        ;;
esac

echo ""
echo "🎉 安装完成！"
echo ""
echo "验证安装:"
echo "  $BINARY_PATH --version"
echo ""
if [ "$choice" != "4" ]; then
    echo "或者（如果已添加到 PATH）:"
    echo "  opencode --version"
    echo ""
fi
echo "测试 fix 命令:"
echo "  $BINARY_PATH fix --help"
echo ""
