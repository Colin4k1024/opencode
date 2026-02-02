# 在其他项目中使用开发版本

## 问题

系统默认的 `opencode` 命令指向系统安装的版本（1.1.21），不包含新添加的 fix 功能。

我们构建的开发版本（0.0.0-dev-\*）包含 fix 功能，位于 `~/.local/bin/opencode`。

## 解决方案

### 方法 1: 使用完整路径（最简单）

```bash
# 在任何项目中
~/.local/bin/opencode fix "错误信息"
~/.local/bin/opencode agent list | grep fix
```

### 方法 2: 创建别名（推荐）

```bash
# 添加到 ~/.zshrc
echo 'alias opencode-dev="~/.local/bin/opencode"' >> ~/.zshrc
source ~/.zshrc

# 使用
opencode-dev fix "错误信息"
```

### 方法 3: 项目级配置

在项目根目录创建 `.opencode-dev` 文件：

```bash
cd ~/Desktop/code/bpms-20260105001
cat > .opencode-dev << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
alias opencode-dev='~/.local/bin/opencode'
EOF

# 使用
source .opencode-dev
opencode-dev fix "错误信息"
```

### 方法 4: 临时修改 PATH

```bash
# 当前会话有效
export PATH="$HOME/.local/bin:$PATH"
opencode fix "错误信息"  # 现在会使用开发版本
```

## 验证

```bash
# 检查版本
~/.local/bin/opencode --version
# 应该显示: 0.0.0-dev-202601150723

# 检查 fix agent
~/.local/bin/opencode agent list | grep fix
# 应该显示: fix (primary)
```

## 快速设置脚本

已创建 `use-dev-version.sh`，运行：

```bash
source /Users/jiafan/Desktop/poc/opencode/use-dev-version.sh
```

## 在你的项目中使用

```bash
cd ~/Desktop/code/bpms-20260105001

# 方式 1: 直接使用完整路径
~/.local/bin/opencode fix "TypeError: ..."

# 方式 2: 使用别名（如果已设置）
opencode-dev fix "TypeError: ..."

# 方式 3: 临时激活（当前终端会话）
export PATH="$HOME/.local/bin:$PATH"
opencode fix "TypeError: ..."
```

## 区分版本

```bash
# 系统版本
which opencode
opencode --version  # 1.1.21

# 开发版本
~/.local/bin/opencode --version  # 0.0.0-dev-*
```
