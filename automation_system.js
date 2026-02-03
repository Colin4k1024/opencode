/**
 * OpenCode 自动化托管系统主程序
 * 集成 TUI 控制器和任务调度器，实现完整的自动化托管模式
 */

import OpenCodeAutomationController from './automation_controller.js';
import TaskScheduler from './task_scheduler.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class OpenCodeAutomationSystem {
  constructor(config = {}) {
    this.config = {
      projectDir: config.projectDir || process.cwd(),
      model: config.model || null,
      agent: config.agent || 'build',
      autoStart: config.autoStart !== false, // 默认自动启动
      taskPollInterval: config.taskPollInterval || 5000, // 5秒轮询间隔
      ...config
    };
    
    this.controller = new OpenCodeAutomationController({
      projectDir: this.config.projectDir,
      model: this.config.model,
      agent: this.config.agent
    });
    
    this.scheduler = new TaskScheduler();
    this.isInitialized = false;
    this.taskPollTimer = null;
    
    // 绑定事件处理器
    this.setupEventHandlers();
  }

  /**
   * 设置事件处理器
   */
  setupEventHandlers() {
    // TUI 输出事件
    this.controller.on('tui-output', (output) => {
      console.log('[TUI OUTPUT]', output);
      this.handleTUIOutput(output);
    });

    // TUI 错误事件
    this.controller.on('tui-error', (error) => {
      console.error('[TUI ERROR]', error);
      this.handleTUIError(error);
    });

    // TUI 关闭事件
    this.controller.on('tui-closed', (code) => {
      console.log(`[TUI CLOSED] Exit code: ${code}`);
      this.handleTUIClosed(code);
    });

    // 任务相关事件
    this.controller.on('task-added', (task) => {
      console.log(`[TASK ADDED] ${task.description}`);
    });

    this.controller.on('task-completed', (data) => {
      console.log(`[TASK COMPLETED] ${data.task.description}`);
      this.handleTaskCompletion(data);
    });

    this.controller.on('task-failed', (data) => {
      console.error(`[TASK FAILED] ${data.task.description}:`, data.error);
      this.handleTaskFailure(data);
    });
  }

  /**
   * 初始化系统
   */
  async initialize() {
    console.log('Initializing OpenCode Automation System...');
    
    try {
      // 检查项目目录
      await this.validateProjectDir();
      
      // 启动组件
      if (this.config.autoStart) {
        await this.startTUIMode();
      }
      
      // 启动任务轮询
      this.startTaskPolling();
      
      this.isInitialized = true;
      console.log('OpenCode Automation System initialized successfully');
      
      return true;
    } catch (error) {
      console.error('Failed to initialize OpenCode Automation System:', error);
      return false;
    }
  }

  /**
   * 验证项目目录
   */
  async validateProjectDir() {
    try {
      await fs.access(this.config.projectDir);
      const stat = await fs.stat(this.config.projectDir);
      
      if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${this.config.projectDir}`);
      }
      
      console.log(`Validated project directory: ${this.config.projectDir}`);
    } catch (error) {
      throw new Error(`Invalid project directory ${this.config.projectDir}: ${error.message}`);
    }
  }

  /**
   * 启动 TUI 模式
   */
  async startTUIMode() {
    console.log('Starting OpenCode TUI mode...');
    
    const success = await this.controller.startTUI();
    
    if (success) {
      console.log('OpenCode TUI mode started successfully');
    } else {
      console.error('Failed to start OpenCode TUI mode');
    }
    
    return success;
  }

  /**
   * 停止 TUI 模式
   */
  stopTUIMode() {
    console.log('Stopping OpenCode TUI mode...');
    this.controller.stop();
  }

  /**
   * 开始任务轮询
   */
  startTaskPolling() {
    console.log(`Starting task polling (interval: ${this.config.taskPollInterval}ms)`);
    
    this.taskPollTimer = setInterval(() => {
      this.pollTasks();
    }, this.config.taskPollInterval);
  }

  /**
   * 停止任务轮询
   */
  stopTaskPolling() {
    if (this.taskPollTimer) {
      clearInterval(this.taskPollTimer);
      this.taskPollTimer = null;
      console.log('Task polling stopped');
    }
  }

  /**
   * 轮询任务
   */
  async pollTasks() {
    try {
      // 这里可以实现从外部源获取任务的逻辑
      // 例如：从文件、数据库、API 或队列中获取任务
      const externalTasks = await this.checkExternalTasks();
      
      for (const task of externalTasks) {
        await this.addTask(task);
      }
      
      // 输出当前系统状态
      this.outputSystemStatus();
    } catch (error) {
      console.error('Error during task polling:', error);
    }
  }

  /**
   * 检查外部任务源
   */
  async checkExternalTasks() {
    // 示例：检查任务队列文件
    const taskQueuePath = path.join(this.config.projectDir, '.opencode', 'task_queue.json');
    
    try {
      const queueData = await fs.readFile(taskQueuePath, 'utf8');
      const queue = JSON.parse(queueData);
      
      // 只返回状态为 'pending' 的任务
      return queue.filter(task => task.status === 'pending');
    } catch (error) {
      // 如果文件不存在或解析失败，返回空数组
      if (error.code !== 'ENOENT') {
        console.error('Error reading task queue:', error);
      }
      return [];
    }
  }

  /**
   * 添加任务到调度器
   */
  async addTask(taskDefinition) {
    console.log(`Adding task: ${taskDefinition.description || 'Unnamed task'}`);
    
    // 将任务添加到调度器
    const taskId = await this.scheduler.addTask(taskDefinition);
    
    return taskId;
  }

  /**
   * 处理 TUI 输出
   */
  handleTUIOutput(output) {
    // 分析 TUI 输出，可能触发自动化响应
    if (output.includes('Waiting for input')) {
      // 可以在这里添加自动响应逻辑
      console.log('TUI is waiting for input');
    } else if (output.includes('Processing')) {
      console.log('TUI is processing a request');
    }
    
    // 检查是否需要根据输出触发新任务
    this.analyzeOutputAndTriggerTasks(output);
  }

  /**
   * 分析输出并触发任务
   */
  analyzeOutputAndTriggerTasks(output) {
    // 示例：如果检测到特定关键词，触发相应任务
    if (output.toLowerCase().includes('analysis complete')) {
      // 可以添加后续任务，比如生成报告等
      console.log('Analysis complete detected, could trigger follow-up tasks');
    }
  }

  /**
   * 处理 TUI 错误
   */
  handleTUIError(error) {
    console.error('TUI Error:', error);
    
    // 根据错误类型决定是否重启 TUI
    if (this.shouldRestartOnError(error)) {
      console.log('Restarting TUI due to error...');
      setTimeout(() => {
        this.restartTUIMode();
      }, 5000); // 5秒后重启
    }
  }

  /**
   * 确定是否应该因错误重启
   */
  shouldRestartOnError(error) {
    // 定义需要重启的错误类型
    const restartErrors = [
      'connection failed',
      'disconnected',
      'crashed',
      'unexpected exit'
    ];
    
    const errorStr = error.toLowerCase();
    return restartErrors.some(restartError => errorStr.includes(restartError));
  }

  /**
   * 重启 TUI 模式
   */
  async restartTUIMode() {
    console.log('Restarting OpenCode TUI mode...');
    
    this.controller.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
    await this.startTUIMode();
  }

  /**
   * 处理 TUI 关闭
   */
  handleTUIClosed(exitCode) {
    console.log(`TUI closed with exit code: ${exitCode}`);
    
    // 如果不是正常关闭，尝试重启
    if (exitCode !== 0) {
      console.log('TUI exited unexpectedly, restarting...');
      setTimeout(() => {
        this.restartTUIMode();
      }, 3000);
    }
  }

  /**
   * 处理任务完成
   */
  handleTaskCompletion(data) {
    console.log(`Task completed: ${data.task.id}`);
    
    // 可以在这里添加任务完成后的处理逻辑
    // 比如：更新状态文件、触发后续任务等
    this.updateTaskStatus(data.task.id, 'completed');
  }

  /**
   * 处理任务失败
   */
  handleTaskFailure(data) {
    console.error(`Task failed: ${data.task.id}`, data.error);
    
    // 更新任务状态为失败
    this.updateTaskStatus(data.task.id, 'failed', data.error);
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(taskId, status, error = null) {
    // 更新任务队列文件中的任务状态
    const taskQueuePath = path.join(this.config.projectDir, '.opencode', 'task_queue.json');
    
    try {
      let queue = [];
      
      // 读取现有队列
      try {
        const queueData = await fs.readFile(taskQueuePath, 'utf8');
        queue = JSON.parse(queueData);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Error reading task queue for update:', error);
        }
      }
      
      // 更新特定任务的状态
      const taskIndex = queue.findIndex(task => task.id === taskId);
      if (taskIndex !== -1) {
        queue[taskIndex].status = status;
        queue[taskIndex].completedAt = new Date().toISOString();
        if (error) {
          queue[taskIndex].error = error.message || error;
        }
        
        // 写回文件
        await fs.writeFile(taskQueuePath, JSON.stringify(queue, null, 2));
      }
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  }

  /**
   * 输出系统状态
   */
  outputSystemStatus() {
    const status = this.controller.getStatus();
    const tasks = this.scheduler.getAllTasks();
    
    console.log('\n=== OpenCode Automation System Status ===');
    console.log(`TUI Running: ${status.isRunning}`);
    console.log(`Uptime: ${status.uptime ? Math.floor(status.uptime / 1000) + 's' : 'N/A'}`);
    console.log(`Pending Tasks: ${tasks.pending.length}`);
    console.log(`Running Tasks: ${tasks.running.length}`);
    console.log(`Task History: ${tasks.history.length}`);
    console.log('========================================\n');
  }

  /**
   * 获取系统状态
   */
  getSystemStatus() {
    return {
      controller: this.controller.getStatus(),
      scheduler: this.scheduler.getAllTasks(),
      isInitialized: this.isInitialized,
      config: this.config
    };
  }

  /**
   * 关闭系统
   */
  async shutdown() {
    console.log('Shutting down OpenCode Automation System...');
    
    // 停止任务轮询
    this.stopTaskPolling();
    
    // 停止 TUI
    this.stopTUIMode();
    
    // 等待短时间确保清理完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('OpenCode Automation System shut down successfully');
  }
}

// 导出自动化系统
export default OpenCodeAutomationSystem;

// 如果直接运行此脚本，则启动自动化系统
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Starting OpenCode Automation System...');
  
  const automationSystem = new OpenCodeAutomationSystem({
    projectDir: process.cwd(),
    agent: 'build',
    autoStart: true,
    taskPollInterval: 5000
  });
  
  // 初始化系统
  automationSystem.initialize()
    .then(success => {
      if (success) {
        console.log('OpenCode Automation System is running');
        
        // 设置优雅退出
        process.on('SIGINT', async () => {
          console.log('\nReceived SIGINT, shutting down...');
          await automationSystem.shutdown();
          process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
          console.log('\nReceived SIGTERM, shutting down...');
          await automationSystem.shutdown();
          process.exit(0);
        });
      } else {
        console.error('Failed to initialize OpenCode Automation System');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Error starting OpenCode Automation System:', error);
      process.exit(1);
    });
}