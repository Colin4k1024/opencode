/**
 * OpenCode 自动化任务调度器
 * 用于管理自动化任务和与TUI界面交互
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class TaskScheduler {
  constructor() {
    this.tasks = [];
    this.runningTasks = new Map();
    this.taskHistory = [];
  }

  /**
   * 添加新任务
   */
  async addTask(taskDefinition) {
    const taskId = this.generateTaskId();
    const task = {
      id: taskId,
      ...taskDefinition,
      status: 'pending',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    };

    this.tasks.push(task);
    console.log(`Task ${taskId} added: ${task.description || 'Unnamed task'}`);
    
    // 如果是立即执行的任务，直接开始
    if (task.immediate) {
      this.executeTask(taskId);
    }
    
    return taskId;
  }

  /**
   * 生成任务ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 执行任务
   */
  async executeTask(taskId) {
    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      throw new Error(`Task ${taskId} not found`);
    }

    const task = this.tasks[taskIndex];
    this.runningTasks.set(taskId, task);
    
    // 更新任务状态
    task.status = 'running';
    task.startedAt = new Date();
    
    console.log(`Executing task ${taskId}: ${task.description}`);

    try {
      let result;
      
      switch (task.type) {
        case 'opencode-command':
          result = await this.executeOpencodeCommand(task.payload);
          break;
        case 'file-operation':
          result = await this.executeFileOperation(task.payload);
          break;
        case 'shell-command':
          result = await this.executeShellCommand(task.payload);
          break;
        case 'custom-script':
          result = await this.executeCustomScript(task.payload);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      // 更新任务结果
      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;
      
      console.log(`Task ${taskId} completed successfully`);
    } catch (error) {
      task.status = 'failed';
      task.completedAt = new Date();
      task.error = error.message;
      
      console.error(`Task ${taskId} failed:`, error.message);
    } finally {
      this.runningTasks.delete(taskId);
      this.taskHistory.push({ ...task });
      this.tasks.splice(taskIndex, 1); // 移除已完成的任务
      
      // 触发任务完成事件
      this.onTaskCompleted(task);
    }
  }

  /**
   * 执行 OpenCode 命令
   */
  async executeOpencodeCommand(payload) {
    const { command, args = [], options = {} } = payload;
    
    // 构建命令
    let cmd = 'bun run --cwd /Users/jiafan/Desktop/poc/opencode opencode';
    
    if (command) {
      cmd += ` ${command}`;
    }
    
    // 添加参数
    args.forEach(arg => {
      if (typeof arg === 'string') {
        cmd += ` ${arg}`;
      } else if (typeof arg === 'object') {
        Object.entries(arg).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            cmd += ` --${key} ${value}`;
          }
        });
      }
    });
    
    console.log(`Executing OpenCode command: ${cmd}`);
    
    try {
      const { stdout, stderr } = await execAsync(cmd);
      
      if (stderr) {
        console.warn(`Command stderr: ${stderr}`);
      }
      
      console.log(`Command output: ${stdout}`);
      
      return {
        success: true,
        stdout,
        stderr
      };
    } catch (error) {
      console.error(`Command failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr
      };
    }
  }

  /**
   * 执行文件操作
   */
  async executeFileOperation(payload) {
    const { operation, filePath, content, options = {} } = payload;
    
    try {
      switch (operation) {
        case 'read':
          const data = await fs.readFile(filePath, 'utf8');
          return { success: true, content: data };
          
        case 'write':
          await fs.writeFile(filePath, content, 'utf8');
          return { success: true, message: `File written to ${filePath}` };
          
        case 'list':
          const files = await fs.readdir(filePath);
          return { success: true, files };
          
        case 'mkdir':
          await fs.mkdir(filePath, { recursive: true });
          return { success: true, message: `Directory created: ${filePath}` };
          
        case 'exists':
          try {
            await fs.access(filePath);
            return { success: true, exists: true };
          } catch {
            return { success: true, exists: false };
          }
          
        default:
          throw new Error(`Unknown file operation: ${operation}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行 Shell 命令
   */
  async executeShellCommand(payload) {
    const { command, cwd = process.cwd(), timeout = 30000 } = payload;
    
    console.log(`Executing shell command: ${command} in ${cwd}`);
    
    try {
      const { stdout, stderr } = await execAsync(command, { 
        cwd, 
        timeout,
        maxBuffer: 1024 * 1024 * 10 // 10MB
      });
      
      if (stderr) {
        console.warn(`Shell command stderr: ${stderr}`);
      }
      
      return {
        success: true,
        stdout,
        stderr
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout,
        stderr: error.stderr
      };
    }
  }

  /**
   * 执行自定义脚本
   */
  async executeCustomScript(payload) {
    // 这里可以根据需要扩展脚本执行功能
    // 暂时简单地记录脚本执行
    console.log(`Executing custom script: ${payload.scriptPath}`);
    
    // 可以在这里添加对不同类型脚本的支持
    // 如 JavaScript, Python, Shell 等
    
    return {
      success: true,
      message: `Custom script executed: ${payload.scriptPath}`
    };
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    const runningTask = this.runningTasks.get(taskId);
    
    return task || runningTask || null;
  }

  /**
   * 获取所有任务状态
   */
  getAllTasks() {
    return {
      pending: this.tasks,
      running: Array.from(this.runningTasks.values()),
      history: this.taskHistory
    };
  }

  /**
   * 取消任务
   */
  cancelTask(taskId) {
    const taskIndex = this.tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const task = this.tasks[taskIndex];
      task.status = 'cancelled';
      task.completedAt = new Date();
      this.taskHistory.push({ ...task });
      this.tasks.splice(taskIndex, 1);
      return true;
    }
    
    // 如果任务正在运行，暂时无法取消（需要更复杂的进程管理）
    if (this.runningTasks.has(taskId)) {
      console.warn(`Cannot cancel running task ${taskId}. Task is currently executing.`);
      return false;
    }
    
    return false;
  }

  /**
   * 任务完成回调
   */
  onTaskCompleted(task) {
    // 可以在这里添加任务完成后的处理逻辑
    // 例如：发送通知、触发后续任务等
    console.log(`Task completed: ${task.id} - Status: ${task.status}`);
  }
}

// 导出任务调度器
export default TaskScheduler;

// 示例用法
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Initializing OpenCode Task Scheduler...');
  
  const scheduler = new TaskScheduler();
  
  // 示例任务
  scheduler.addTask({
    type: 'opencode-command',
    description: 'Run OpenCode in TUI mode',
    payload: {
      command: 'tui',
      args: ['--project', '.', '--agent', 'build']
    },
    immediate: false
  });
  
  scheduler.addTask({
    type: 'file-operation',
    description: 'Check if config file exists',
    payload: {
      operation: 'exists',
      filePath: './.opencode/config.json'
    },
    immediate: false
  });
  
  console.log('Task scheduler initialized');
}