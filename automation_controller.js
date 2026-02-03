#!/usr/bin/env node

/**
 * OpenCode 自动化托管控制器
 * 实现 TUI 界面的自托管运行，并能够干预命令执行和任务调度
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

class OpenCodeAutomationController extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      projectDir: options.projectDir || '/Users/jiafan/Desktop/poc/opencode',
      model: options.model || null,
      agent: options.agent || 'build',
      session: options.session || null,
      continueLast: options.continueLast || false,
      ...options
    };
    
    this.opencodeProcess = null;
    this.isRunning = false;
    this.taskQueue = [];
    this.currentTask = null;
  }

  /**
   * 启动 OpenCode TUI 界面
   */
  async startTUI() {
    if (this.isRunning) {
      console.log('OpenCode TUI is already running');
      return;
    }

    try {
      console.log(`Starting OpenCode TUI in directory: ${this.options.projectDir}`);
      
      // 构建启动命令
      const args = [];
      
      if (this.options.model) {
        args.push('--model', this.options.model);
      }
      
      if (this.options.agent) {
        args.push('--agent', this.options.agent);
      }
      
      if (this.options.session) {
        args.push('--session', this.options.session);
      }
      
      if (this.options.continueLast) {
        args.push('--continue');
      }

      // 构建完整的命令参数 - project作为第一个参数（位置参数）
      const fullArgs = [this.options.projectDir, ...args];
      
      // 启动 opencode 进程（默认运行TUI）
      this.opencodeProcess = spawn('bun', ['run', 'opencode', ...fullArgs], {
        cwd: '/Users/jiafan/Desktop/poc/opencode',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      this.isRunning = true;
      this.startTime = Date.now();

      // 监听输出
      this.opencodeProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[TUI STDOUT] ${output}`);
        this.emit('tui-output', output);
      });

      this.opencodeProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.error(`[TUI STDERR] ${error}`);
        this.emit('tui-error', error);
      });

      this.opencodeProcess.on('close', (code) => {
        console.log(`OpenCode TUI process exited with code ${code}`);
        this.isRunning = false;
        this.startTime = undefined;
        this.emit('tui-closed', code);
      });

      console.log('OpenCode TUI started successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to start OpenCode TUI:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * 发送命令到 TUI
   */
  sendCommand(command) {
    if (!this.opencodeProcess || !this.isRunning) {
      console.error('OpenCode TUI is not running');
      return false;
    }

    try {
      // 将命令写入进程 stdin
      this.opencodeProcess.stdin.write(command + '\n');
      console.log(`Command sent: ${command}`);
      return true;
    } catch (error) {
      console.error('Failed to send command:', error);
      return false;
    }
  }

  /**
   * 添加任务到队列
   */
  addTask(task) {
    this.taskQueue.push(task);
    console.log(`Task added to queue: ${task.description || 'Unnamed task'}`);
    this.emit('task-added', task);
    
    // 如果没有正在执行的任务，则开始执行
    if (!this.currentTask) {
      this.processNextTask();
    }
  }

  /**
   * 处理下一个任务
   */
  async processNextTask() {
    if (this.taskQueue.length === 0 || this.currentTask) {
      return;
    }

    this.currentTask = this.taskQueue.shift();
    console.log(`Processing task: ${this.currentTask.description}`);

    try {
      // 执行任务
      const result = await this.executeTask(this.currentTask);
      this.emit('task-completed', { task: this.currentTask, result });
    } catch (error) {
      console.error(`Task failed: ${error.message}`);
      this.emit('task-failed', { task: this.currentTask, error });
    } finally {
      this.currentTask = null;
      
      // 处理下一个任务
      setImmediate(() => this.processNextTask());
    }
  }

  /**
   * 执行特定任务
   */
  async executeTask(task) {
    switch (task.type) {
      case 'command':
        return this.sendCommand(task.content);
      case 'prompt':
        // 发送提示给 TUI
        return this.sendCommand(task.content);
      case 'session-switch':
        // 切换会话
        return this.sendCommand(`session.switch(${task.sessionId})`);
      case 'agent-switch':
        // 切换代理
        return this.sendCommand(`agent.switch(${task.agent})`);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * 停止 TUI 进程
   */
  stop() {
    if (this.opencodeProcess && this.isRunning) {
      console.log('Stopping OpenCode TUI...');
      this.opencodeProcess.kill('SIGTERM');
      this.isRunning = false;
      this.startTime = undefined;
    }
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      taskQueueLength: this.taskQueue.length,
      currentTask: this.currentTask,
      uptime: this.isRunning ? Date.now() - this.startTime : null
    };
  }
}

// 导出控制器类
export default OpenCodeAutomationController;

// 如果直接运行此脚本，则启动控制器
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Starting OpenCode Automation Controller...');
  
  const controller = new OpenCodeAutomationController({
    projectDir: process.cwd(),
    agent: 'build'
  });

  // 启动 TUI
  controller.startTUI();

  // 示例：添加一些任务
  controller.addTask({
    type: 'prompt',
    content: 'Hello, can you help me analyze this project?',
    description: 'Initial greeting to OpenCode'
  });

  // 监听事件
  controller.on('tui-output', (output) => {
    console.log('TUI Output:', output);
  });

  controller.on('task-completed', (data) => {
    console.log('Task completed:', data.task.description);
  });

  // 优雅退出
  process.on('SIGINT', () => {
    console.log('\nShutting down OpenCode Automation Controller...');
    controller.stop();
    process.exit(0);
  });
}
