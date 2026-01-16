# 测试 Fix 命令指南

## 前置要求

1. **安装 Bun**

   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

   或者使用 npm:

   ```bash
   npm install -g bun
   ```

2. **安装依赖**
   ```bash
   cd /Users/jiafan/Desktop/poc/opencode
   bun install
   ```

## 本地开发测试

### 方法 1: 使用 `bun dev` (推荐用于开发)

这是最快的测试方式，直接运行 TypeScript 源码：

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun dev fix --help
```

测试 fix 命令：

```bash
# 测试帮助信息
bun dev fix --help

# 测试基本功能（需要提供错误信息）
bun dev fix "TypeError: Cannot read property 'x' of undefined"

# 测试从文件读取错误
bun dev fix --file error.log

# 测试自动修复模式
bun dev fix "syntax error" --auto
```

### 方法 2: 构建二进制文件

如果需要构建可执行文件：

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun run script/build.ts --single
```

这会为当前平台构建二进制文件到 `dist/` 目录。

## 测试场景

### 1. 测试命令注册

```bash
bun dev fix --help
```

应该显示 fix 命令的帮助信息。

### 2. 测试基本错误修复

创建一个测试文件 `test-error.ts`:

```typescript
const x = undefined
console.log(x.y) // 这会产生错误
```

然后运行：

```bash
bun dev fix "TypeError: Cannot read property 'y' of undefined in test-error.ts"
```

### 3. 测试配置读取工具

```bash
# 在项目目录中测试读取配置
bun dev run "use config-reader tool to read package.json"
```

### 4. 测试 SQL 工具（如果有数据库）

```bash
# 需要先配置数据库连接（.env 或 drizzle.config.ts）
bun dev run "use sql tool to query SELECT * FROM users LIMIT 5"
```

### 5. 测试完整修复流程

1. 创建一个有错误的文件
2. 运行编译或测试产生错误
3. 使用 fix 命令修复：
   ```bash
   bun dev fix "编译错误信息"
   ```

## 验证功能

### 检查工具是否注册

```bash
bun dev agent list
```

应该能看到 `fix` agent 在列表中。

### 检查权限配置

检查 `packages/opencode/src/config/config.ts` 中是否包含：

- `sql: PermissionRule.optional()`
- `config_reader: PermissionRule.optional()`

### 检查命令是否注册

检查 `packages/opencode/src/index.ts` 中是否包含：

- `import { FixCommand } from "./cli/cmd/fix"`
- `.command(FixCommand)`

## 常见问题

### 1. "bun: command not found"

需要先安装 Bun（见前置要求）。

### 2. 模块找不到错误

运行 `bun install` 安装所有依赖。

### 3. SQL 工具数据库连接失败

确保：

- 有 `.env` 文件包含 `DATABASE_URL`
- 或者有 `drizzle.config.ts` 或 `prisma/schema.prisma` 配置文件
- 数据库服务正在运行

### 4. Fix agent 未找到

检查 `packages/opencode/src/agent/agent.ts` 中是否正确定义了 `fix` agent。

## 调试技巧

1. **查看日志**:

   ```bash
   bun dev fix "error" --print-logs --log-level DEBUG
   ```

2. **使用 JSON 格式输出**:

   ```bash
   bun dev fix "error" --format json
   ```

3. **检查工具是否可用**:
   在 opencode 会话中，agent 应该能够使用 `sql` 和 `config-reader` 工具。
