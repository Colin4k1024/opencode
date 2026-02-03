# OpenCode 自动化托管系统

这是一个完整的自动化托管解决方案，用于运行 OpenCode 的 TUI 界面并提供任务调度和命令干预功能。

## 概述

该系统包含以下核心组件：

1. **TUI 控制器** - 管理 OpenCode TUI 界面的启动和交互
2. **任务调度器** - 管理自动化任务队列和执行
3. **自动化系统** - 集成所有组件并提供统一接口
4. **启动脚本** - 便捷的命令行工具来管理整个系统

## 架构

```
┌─────────────────────────────────────┐
│    OpenCode Automation System       │
├─────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────┐ │
│ │  TUI Controller │ │  Scheduler  │ │
│ │                 │ │             │ │
│ │ - Start TUI     │ │ - Task      │ │
│ │ - Send Commands │ │   Queue     │ │
│ │ - Monitor       │ │ - Schedule  │ │
│ └─────────────────┘ └─────────────┘ │
└─────────────────────────────────────┘
```

## 功能特性

- **自托管 TUI 运行** - OpenCode TUI 可以在后台持续运行
- **任务调度** - 支持排队、调度和执行各种类型的任务
- **命令干预** - 可以动态发送命令到 TUI 界面
- **状态监控** - 实时监控系统和任务状态
- **自动重启** - 异常情况下自动重启服务
- **日志记录** - 详细的运行日志

## 快速开始

### 1. 安装依赖

```bash
cd /Users/jiafan/Desktop/poc/opencode
./start_automation.sh install
```

### 2. 启动自动化系统

```bash
./start_automation.sh start
```

### 3. 检查状态

```bash
./start_automation.sh status
```

### 4. 停止系统

```bash
./start_automation.sh stop
```

## 配置

系统配置位于 `automation_config.json`，主要配置项包括：

- `projectDir` - 项目根目录
- `model` - 使用的 AI 模型
- `agent` - 默认代理类型
- `autoStart` - 是否自动启动 TUI
- `taskPollInterval` - 任务轮询间隔

## 任务类型

系统支持多种类型的任务：

### OpenCode 命令任务
```javascript
{
  "type": "opencode-command",
  "description": "Run OpenCode command",
  "payload": {
    "command": "tui",
    "args": ["--project", ".", "--agent", "build"]
  }
}
```

### 文件操作任务
```javascript
{
  "type": "file-operation",
  "description": "Read configuration file",
  "payload": {
    "operation": "read",
    "filePath": "./config.json"
  }
}
```

### Shell 命令任务
```javascript
{
  "type": "shell-command",
  "description": "List directory contents",
  "payload": {
    "command": "ls -la",
    "cwd": "/path/to/project"
  }
}
```

## 任务队列

任务可以通过 `.opencode/task_queue.json` 文件进行管理：

```json
[
  {
    "id": "task_123456789",
    "type": "opencode-command",
    "description": "Initial project analysis",
    "payload": {
      "command": "analyze",
      "args": ["--project", "."]
    },
    "status": "pending",
    "createdAt": "2025-01-04T10:00:00Z"
  }
]
```

## API 接口

系统提供了编程接口来管理任务和状态：

```javascript
import OpenCodeAutomationSystem from './automation_system.js';

const system = new OpenCodeAutomationSystem({
  projectDir: process.cwd(),
  agent: 'build'
});

// 初始化系统
await system.initialize();

// 添加任务
await system.addTask({
  type: 'opencode-command',
  description: 'Run analysis',
  payload: {
    command: 'analyze',
    args: ['--project', '.']
  }
});

// 获取系统状态
const status = system.getSystemStatus();
```

## 监控和日志

- 系统状态通过控制台输出显示
- 任务状态变化会触发相应的事件
- 可以通过 `status` 命令查看当前运行状态

## 错误处理

- TUI 异常时自动重启
- 任务执行失败时记录错误并继续处理其他任务
- 提供详细的错误日志便于调试

## 部署建议

- 在生产环境中使用进程管理器（如 PM2）来管理自动化系统
- 配置适当的日志轮转策略
- 监控系统资源使用情况
- 定期备份任务队列和配置文件

## 开发

要扩展系统功能，可以在以下文件中进行修改：

- `automation_system.js` - 主系统逻辑
- `automation_controller.js` - TUI 控制逻辑
- `task_scheduler.js` - 任务调度逻辑
- `start_automation.sh` - 启动脚本

## 故障排除

### 系统无法启动

1. 检查依赖是否正确安装：`./start_automation.sh install`
2. 检查配置文件是否正确：`automation_config.json`
3. 查看详细日志信息

### TUI 无响应

1. 检查 TUI 进程状态：`./start_automation.sh status`
2. 重启系统：`./start_automation.sh restart`
3. 检查是否有资源限制

### 任务不执行

1. 检查任务队列文件格式
2. 确认任务状态为 'pending'
3. 检查系统日志以了解错误详情