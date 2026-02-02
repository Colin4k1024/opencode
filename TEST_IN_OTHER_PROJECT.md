# 在其他项目中测试 Fix 功能

## ✅ 安装完成

你的本地构建版本已安装到：

- 路径: `~/.local/bin/opencode`
- 版本: `0.0.0-dev-202601150704` (开发版本)

## 使用方式

### 方式 1: 使用完整路径（推荐，避免与系统版本冲突）

```bash
# 在任何项目中
~/.local/bin/opencode fix "错误信息"
```

### 方式 2: 使用别名

在 `~/.zshrc` 中添加：

```bash
alias opencode-dev='~/.local/bin/opencode'
```

然后使用：

```bash
opencode-dev fix "错误信息"
```

### 方式 3: 临时覆盖 PATH

```bash
export PATH="$HOME/.local/bin:$PATH"
opencode fix "错误信息"
```

## 测试项目示例

已在 `~/test-opencode-fix` 创建了测试项目，包含：

1. **package.json** - 项目配置
2. **test-error.ts** - 包含错误的测试文件

### 测试步骤

```bash
# 1. 进入测试项目
cd ~/test-opencode-fix

# 2. 查看测试文件
cat test-error.ts

# 3. 测试 fix 命令（需要配置 AI provider）
~/.local/bin/opencode fix "TypeError: Cannot read property 'property' of undefined in test-error.ts"

# 4. 测试配置读取
~/.local/bin/opencode run "use config-reader tool to read package.json"

# 5. 查看 fix agent
~/.local/bin/opencode agent list | grep fix
```

## 在实际项目中使用

### 示例 1: 修复 TypeScript 编译错误

```bash
cd /path/to/your/typescript/project

# 运行编译查看错误
tsc 2>&1 | tee compile-errors.log

# 使用 fix 命令修复
~/.local/bin/opencode fix --file compile-errors.log
```

### 示例 2: 修复运行时错误

```bash
cd /path/to/your/project

# 运行程序捕获错误
node app.js 2>&1 | tee runtime-errors.log

# 使用 fix 命令修复
~/.local/bin/opencode fix --file runtime-errors.log
```

### 示例 3: 修复测试失败

```bash
cd /path/to/your/project

# 运行测试
npm test 2>&1 | tee test-errors.log

# 使用 fix 命令修复
~/.local/bin/opencode fix --file test-errors.log
```

## 配置 AI Provider

### 快速配置（使用环境变量）

```bash
# 设置 API key
export OPENAI_API_KEY=your-api-key-here

# 使用 fix 命令
~/.local/bin/opencode fix "错误信息" --model openai/gpt-4
```

### 项目级配置

在项目根目录创建 `.opencode/opencode.json`:

```json
{
  "model": "openai/gpt-4",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "your-api-key-here"
      }
    }
  }
}
```

### 全局配置

在 `~/.opencode/opencode.json` 创建全局配置。

## 功能验证清单

- [ ] `~/.local/bin/opencode --version` 显示开发版本
- [ ] `~/.local/bin/opencode fix --help` 显示帮助信息
- [ ] `~/.local/bin/opencode agent list` 包含 `fix (primary)`
- [ ] 可以读取项目配置文件（config-reader 工具）
- [ ] 可以执行 SQL 查询（sql 工具，需要数据库配置）
- [ ] 可以分析和修复错误（需要 AI provider 配置）

## 常见问题

### Q: 如何区分系统版本和开发版本？

```bash
# 系统版本（如果已安装）
which opencode
opencode --version  # 显示 1.1.21

# 开发版本
~/.local/bin/opencode --version  # 显示 0.0.0-dev-*
```

### Q: 如何更新开发版本？

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun run script/build.ts --single
# 二进制文件会自动更新，无需重新安装
```

### Q: 如何卸载？

```bash
rm ~/.local/bin/opencode
```

### Q: 如何查看日志？

```bash
~/.local/bin/opencode fix "error" --print-logs --log-level DEBUG
```

## 下一步

1. 配置 AI provider（OpenAI, Anthropic 等）
2. 在实际项目中测试 fix 功能
3. 测试各种错误场景（编译错误、运行时错误、测试失败等）
4. 测试配置读取和 SQL 查询功能
