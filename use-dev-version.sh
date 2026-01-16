#!/bin/bash

# 快速切换到开发版本的脚本
# 在项目目录中运行此脚本，或 source 它

# 方法 1: 创建别名（推荐）
if ! grep -q "alias opencode-dev=" ~/.zshrc 2>/dev/null; then
    echo 'alias opencode-dev="~/.local/bin/opencode"' >> ~/.zshrc
    echo "✅ 已添加别名 opencode-dev 到 ~/.zshrc"
    echo "   运行: source ~/.zshrc"
fi

# 方法 2: 临时覆盖 PATH（当前会话）
export PATH="$HOME/.local/bin:$PATH"

echo ""
echo "✅ 开发版本已激活"
echo ""
echo "当前版本:"
~/.local/bin/opencode --version

echo ""
echo "Fix agent 状态:"
~/.local/bin/opencode agent list 2>&1 | grep -i fix || echo "  (未找到，可能需要重新构建)"

echo ""
echo "使用方法:"
echo "  1. 使用完整路径: ~/.local/bin/opencode fix '错误信息'"
echo "  2. 使用别名: opencode-dev fix '错误信息' (需要 source ~/.zshrc)"
echo "  3. 当前会话: opencode fix '错误信息' (PATH 已临时修改)"
