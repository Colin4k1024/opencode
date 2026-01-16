# 快速测试指南

## ✅ 安装状态

- ✅ 二进制文件已构建: `dist/opencode-darwin-arm64/bin/opencode`
- ✅ 已安装到: `~/.local/bin/opencode`
- ✅ PATH 已配置

## 快速测试

### 1. 验证安装

```bash
# 检查版本
opencode --version

# 检查 fix 命令
opencode fix --help

# 检查 fix agent
opencode agent list | grep fix
```

### 2. 在测试项目中测试

```bash
# 进入测试目录
cd ~/test-opencode-fix

# 初始化项目
npm init -y

# 创建有错误的文件
cat > error.ts << 'EOF'
const x: any = undefined;
console.log(x.property);
EOF

# 测试 fix 命令（需要配置 AI provider）
opencode fix "TypeError: Cannot read property 'property' of undefined"
```

### 3. 测试配置读取工具

```bash
cd ~/test-opencode-fix

# 创建 package.json
echo '{"name": "test", "version": "1.0.0"}' > package.json

# 使用 run 命令测试 config-reader
opencode run "use config-reader tool to read package.json"
```

### 4. 测试 SQL 工具（需要数据库）

```bash
cd ~/test-opencode-fix

# 创建 .env 文件（示例）
echo "DATABASE_URL=postgresql://user:pass@localhost:5432/dbname" > .env

# 测试 SQL 工具
opencode run "use sql tool to query SELECT 1 as test"
```

## 在其他项目中使用

现在你可以在任何项目中使用 opencode fix 命令：

```bash
# 进入你的项目
cd /path/to/your/project

# 使用 fix 命令
opencode fix "你的错误信息"

# 或者附加错误日志文件
opencode fix --file error.log

# 使用自动修复模式
opencode fix "简单错误" --auto
```

## 配置 AI Provider

Fix 功能需要 AI 模型。配置方式：

### 方法 1: 命令行参数

```bash
opencode fix "error" --model openai/gpt-4
```

### 方法 2: 配置文件

在项目根目录创建 `.opencode/opencode.json`:

```json
{
  "model": "openai/gpt-4",
  "provider": {
    "openai": {
      "options": {
        "apiKey": "your-api-key"
      }
    }
  }
}
```

### 方法 3: 环境变量

```bash
export OPENAI_API_KEY=your-api-key
opencode fix "error" --model openai/gpt-4
```

## 更新安装

修改代码后重新构建：

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun run script/build.ts --single

# 二进制文件会自动更新，符号链接无需修改
```

## 故障排除

### 命令未找到

```bash
# 检查安装
ls -la ~/.local/bin/opencode

# 检查 PATH
echo $PATH | grep .local/bin

# 重新加载 shell
source ~/.zshrc
```

### 权限问题

```bash
chmod +x ~/.local/bin/opencode
```

### 重新安装

```bash
# 删除旧链接
rm ~/.local/bin/opencode

# 重新创建链接
ln -sf /Users/jiafan/Desktop/poc/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencode
```
