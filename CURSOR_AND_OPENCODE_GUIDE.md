# Cursor Agent 和 OpenCode Dev 命令使用指南

## 1. Cursor Agent 命令

### 基本用法
```bash
# 启动 Cursor Agent
cursor agent "分析当前项目的结构"

# 以计划模式启动（只读）
cursor agent --mode plan "请分析这个项目的架构"

# 以问答模式启动
cursor agent --mode ask "解释这个函数的作用"

# 列出可用模型
cursor agent models

# 检查状态
cursor agent status
```

### 高级用法
```bash
# 使用特定模型
cursor agent --model gpt-5 "请重构这段代码"

# 在特定工作区运行
cursor agent --workspace /path/to/project "分析这个项目"

# 以云模式启动
cursor agent --cloud
```

## 2. OpenCode Dev 命令

### 基本用法
```bash
# 使用开发版本的 opencode（当前会话已激活）
opencode --version  # 显示 0.0.0-dev-* 版本

# 使用 fix agent（最新功能）
opencode agent list | grep fix  # 应该显示 fix (primary)

# 运行 fix agent 来解决错误
opencode fix "TypeError: Cannot read property 'length' of undefined"
```

### 开发版本特定功能
```bash
# 使用完整路径（始终使用开发版本）
~/.local/bin/opencode fix "错误信息"

# 或使用别名（如果已设置）
opencode-dev fix "错误信息"
```

## 3. 实际操作示例

### 示例 1: 使用 Cursor Agent 分析项目
```bash
cd /Users/jiafan/Desktop/poc/opencode
cursor agent "分析这个 OpenCode 项目的整体架构和主要组件"
```

### 示例 2: 使用 OpenCode Dev 版本处理任务
```bash
cd /Users/jiafan/Desktop/poc/opencode
opencode run "请生成该项目的 README 文件"
```

### 示例 3: 使用 fix agent 解决问题
```bash
cd /Users/jiafan/Desktop/poc/opencode
opencode fix "项目构建时出现依赖冲突问题"
```

## 4. 配置说明

### 临时激活开发版本（当前会话）
当前会话已经通过以下命令激活了开发版本：
```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 永久激活开发版本
要永久激活 opencode-dev 命令，请将以下内容添加到 ~/.zshrc：
```bash
alias opencode-dev="~/.local/bin/opencode"
```

然后运行：
```bash
source ~/.zshrc
```

## 5. 验证命令是否正常工作

```bash
# 验证 Cursor
cursor --version

# 验证 OpenCode 开发版本
~/.local/bin/opencode --version
opencode fix --help  # 应该显示 fix agent 帮助信息
```