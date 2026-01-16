# 本地编译和安装 OpenCode Fix 功能指南

## 步骤 1: 编译二进制文件

在项目根目录执行：

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun run script/build.ts --single
```

这会为当前平台（macOS ARM64）构建二进制文件，输出到：

```
dist/opencode-darwin-arm64/bin/opencode
```

**注意**: 构建过程可能需要几分钟时间，请耐心等待。

## 步骤 2: 安装到系统

### 方法 1: 直接使用构建的二进制（推荐用于测试）

```bash
# 创建符号链接到 /usr/local/bin（需要 sudo）
sudo ln -sf /Users/jiafan/Desktop/poc/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode /usr/local/bin/opencode

# 或者安装到用户目录（不需要 sudo）
mkdir -p ~/.local/bin
ln -sf /Users/jiafan/Desktop/poc/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode ~/.local/bin/opencode

# 确保 ~/.local/bin 在 PATH 中
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### 方法 2: 使用 npm link（开发模式）

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
npm link

# 这会创建一个全局符号链接
# 现在可以在任何地方使用 opencode 命令
```

### 方法 3: 直接使用完整路径

```bash
# 直接使用完整路径运行
/Users/jiafan/Desktop/poc/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode fix --help
```

## 步骤 3: 验证安装

```bash
# 检查命令是否可用
opencode --version

# 检查 fix 命令
opencode fix --help

# 检查 fix agent
opencode agent list | grep fix
```

## 步骤 4: 在其他项目测试

### 创建测试项目

```bash
# 创建测试目录
mkdir -p ~/test-opencode-fix
cd ~/test-opencode-fix

# 初始化项目
npm init -y

# 创建一个有错误的文件
cat > test-error.ts << 'EOF'
const x: any = undefined;
console.log(x.property); // 这会产生运行时错误
EOF
```

### 测试 fix 功能

```bash
# 1. 测试基本功能
opencode fix "TypeError: Cannot read property 'property' of undefined in test-error.ts"

# 2. 测试配置读取
opencode run "use config-reader tool to read package.json"

# 3. 如果有数据库，测试 SQL 工具
# 先创建 .env 文件
echo "DATABASE_URL=postgresql://user:password@localhost:5432/dbname" > .env
opencode run "use sql tool to query SELECT 1 as test"
```

## 配置 AI Provider

Fix 功能需要 AI 模型。配置方式：

### 方法 1: 使用命令行参数

```bash
opencode fix "error message" --model openai/gpt-4
```

### 方法 2: 创建配置文件

在项目根目录或 `~/.opencode/` 创建 `opencode.json`:

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

### 方法 3: 使用环境变量

```bash
export OPENAI_API_KEY=your-api-key-here
opencode fix "error message" --model openai/gpt-4
```

## 测试场景

### 1. TypeScript 编译错误

```bash
# 创建有编译错误的文件
cat > error.ts << 'EOF'
function test(x: string) {
  return x + 1; // 类型错误
}
EOF

opencode fix "Type 'number' is not assignable to type 'string' in error.ts"
```

### 2. 运行时错误

```bash
# 创建有运行时错误的文件
cat > runtime-error.js << 'EOF'
const arr = [1, 2, 3];
console.log(arr[10].toString()); // 数组越界
EOF

opencode fix "TypeError: Cannot read property 'toString' of undefined"
```

### 3. 配置问题

```bash
# 测试读取项目配置
opencode run "use config-reader to read tsconfig.json and explain the configuration"
```

## 故障排除

### 问题 1: 命令未找到

```bash
# 检查 PATH
echo $PATH

# 检查二进制文件是否存在
ls -la /Users/jiafan/Desktop/poc/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode

# 检查符号链接
which opencode
ls -la $(which opencode)
```

### 问题 2: 权限错误

```bash
# 给二进制文件添加执行权限
chmod +x /Users/jiafan/Desktop/poc/opencode/packages/opencode/dist/opencode-darwin-arm64/bin/opencode
```

### 问题 3: 构建失败

```bash
# 清理并重新构建
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
rm -rf dist node_modules
bun install
bun run script/build.ts --single
```

### 问题 4: Fix agent 未找到

```bash
# 检查 agent 是否注册
opencode agent list

# 如果看不到 fix agent，检查源码
grep -r "fix:" /Users/jiafan/Desktop/poc/opencode/packages/opencode/src/agent/agent.ts
```

## 更新本地安装

当修改代码后，需要重新构建：

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun run script/build.ts --single

# 如果使用了符号链接，不需要重新安装，直接使用新构建的二进制文件
```

## 卸载

```bash
# 删除符号链接
rm /usr/local/bin/opencode  # 如果安装在系统目录
rm ~/.local/bin/opencode    # 如果安装在用户目录

# 或者如果使用了 npm link
npm unlink -g opencode
```
