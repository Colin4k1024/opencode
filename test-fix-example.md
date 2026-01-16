# Fix 命令测试示例

## 验证完成 ✅

1. ✅ Fix 命令已注册 - `bun dev fix --help` 可以显示帮助信息
2. ✅ Fix Agent 已注册 - `bun dev agent list` 显示 `fix (primary)`

## 测试步骤

### 1. 基本测试

测试 fix 命令是否能正常启动：

```bash
cd /Users/jiafan/Desktop/poc/opencode/packages/opencode
bun dev fix "这是一个测试错误"
```

### 2. 测试配置读取工具

创建一个测试项目目录并测试配置读取：

```bash
# 在任意项目目录中
bun dev run "use config-reader tool to read package.json"
```

### 3. 测试 SQL 工具（需要数据库配置）

如果有数据库，可以测试：

```bash
# 确保有 .env 文件包含 DATABASE_URL
bun dev run "use sql tool to query SELECT 1 as test"
```

### 4. 完整修复流程测试

创建一个有错误的 TypeScript 文件：

```typescript
// test-error.ts
const x: any = undefined
console.log(x.property) // 这会产生运行时错误
```

然后运行：

```bash
bun dev fix "TypeError: Cannot read property 'property' of undefined in test-error.ts"
```

## 快速测试命令

```bash
# 1. 查看帮助
bun dev fix --help

# 2. 查看 agent 列表（确认 fix agent 存在）
bun dev agent list | grep fix

# 3. 测试基本功能（需要配置 AI provider）
bun dev fix "syntax error in file.ts at line 10"
```

## 注意事项

1. **需要配置 AI Provider**: fix 命令需要 AI 模型来分析和修复错误
   - 可以通过 `--model` 参数指定模型
   - 或者配置默认模型在配置文件中

2. **权限设置**: 首次使用 sql 或 config-reader 工具时，系统会请求权限确认

3. **数据库连接**: SQL 工具需要：
   - `.env` 文件中的 `DATABASE_URL`
   - 或 `drizzle.config.ts` / `prisma/schema.prisma` 配置文件

## 下一步

现在你可以：

1. 配置 AI provider（如果需要）
2. 在实际项目中测试 fix 功能
3. 创建测试用例验证各种错误修复场景
