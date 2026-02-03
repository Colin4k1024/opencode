#!/bin/bash

# OpenCode 自动化托管模式启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="/Users/jiafan/Desktop/poc/opencode"
CONFIG_FILE="$PROJECT_ROOT/automation_config.json"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查必要依赖
check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v bun &> /dev/null; then
        log_error "bun is not installed. Please install bun first."
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        log_error "node is not installed. Please install node.js first."
        exit 1
    fi
    
    log_success "All dependencies are available"
}

# 检查项目目录
check_project_dir() {
    log_info "Checking project directory: $PROJECT_ROOT"
    
    if [ ! -d "$PROJECT_ROOT" ]; then
        log_error "Project directory does not exist: $PROJECT_ROOT"
        exit 1
    fi
    
    if [ ! -f "$PROJECT_ROOT/package.json" ]; then
        log_error "No package.json found in project directory"
        exit 1
    fi
    
    log_success "Project directory is valid"
}

# 安装项目依赖
install_dependencies() {
    log_info "Installing project dependencies..."
    
    cd "$PROJECT_ROOT"
    
    if [ -f "bun.lock" ]; then
        bun install
    elif [ -f "package-lock.json" ]; then
        npm install
    elif [ -f "yarn.lock" ]; then
        yarn install
    else
        log_warn "No lock file found, installing dependencies..."
        bun install
    fi
    
    log_success "Dependencies installed"
}

# 启动自动化系统
start_automation() {
    log_info "Starting OpenCode Automation System..."
    
    cd "$PROJECT_ROOT"
    
    # 启动自动化系统
    bun run "$PROJECT_ROOT/automation_system.js" &
    AUTOMATION_PID=$!
    
    log_success "OpenCode Automation System started with PID: $AUTOMATION_PID"
    
    # 创建 PID 文件
    echo $AUTOMATION_PID > "$PROJECT_ROOT/.opencode/automation.pid"
    
    # 等待一段时间确保系统启动
    sleep 3
    
    # 检查进程是否仍在运行
    if kill -0 $AUTOMATION_PID 2>/dev/null; then
        log_success "OpenCode Automation System is running"
    else
        log_error "OpenCode Automation System failed to start properly"
        exit 1
    fi
}

# 停止自动化系统
stop_automation() {
    log_info "Stopping OpenCode Automation System..."
    
    if [ -f "$PROJECT_ROOT/.opencode/automation.pid" ]; then
        PID=$(cat "$PROJECT_ROOT/.opencode/automation.pid")
        
        if kill -0 $PID 2>/dev/null; then
            kill -TERM $PID
            sleep 2
            
            # 检查进程是否仍然存在
            if kill -0 $PID 2>/dev/null; then
                log_warn "Process still running, sending SIGKILL..."
                kill -KILL $PID
                sleep 1
            fi
            
            rm -f "$PROJECT_ROOT/.opencode/automation.pid"
            log_success "OpenCode Automation System stopped"
        else
            log_warn "Process with PID $PID is not running"
            rm -f "$PROJECT_ROOT/.opencode/automation.pid"
        fi
    else
        log_warn "No PID file found, checking for running processes..."
        
        # 查找可能的自动化系统进程
        PIDS=$(pgrep -f "automation_system.js")
        if [ ! -z "$PIDS" ]; then
            for PID in $PIDS; do
                log_info "Terminating process $PID"
                kill -TERM $PID
            done
            log_success "Terminated processes: $PIDS"
        else
            log_info "No OpenCode Automation System processes found"
        fi
    fi
}

# 检查自动化系统状态
check_status() {
    if [ -f "$PROJECT_ROOT/.opencode/automation.pid" ]; then
        PID=$(cat "$PROJECT_ROOT/.opencode/automation.pid")
        
        if kill -0 $PID 2>/dev/null; then
            log_info "OpenCode Automation System is running (PID: $PID)"
            
            # 显示一些状态信息
            if [ -f "$PROJECT_ROOT/.opencode/automation_stats.json" ]; then
                log_info "Last stats update:"
                cat "$PROJECT_ROOT/.opencode/automation_stats.json"
            fi
            return 0
        else
            log_warn "PID file exists but process is not running (PID: $PID)"
            rm -f "$PROJECT_ROOT/.opencode/automation.pid"
            return 1
        fi
    else
        log_info "OpenCode Automation System is not running"
        return 1
    fi
}

# 显示帮助信息
show_help() {
    echo "Usage: $0 {start|stop|restart|status|install|help}"
    echo ""
    echo "Commands:"
    echo "  start     Start the OpenCode Automation System"
    echo "  stop      Stop the OpenCode Automation System"
    echo "  restart   Restart the OpenCode Automation System"
    echo "  status    Check the status of the OpenCode Automation System"
    echo "  install   Install dependencies and prepare the system"
    echo "  help      Show this help message"
}

# 创建必要的目录
setup_directories() {
    log_info "Setting up necessary directories..."
    
    mkdir -p "$PROJECT_ROOT/.opencode"
    
    # 创建示例任务队列文件
    if [ ! -f "$PROJECT_ROOT/.opencode/task_queue.json" ]; then
        echo "[]" > "$PROJECT_ROOT/.opencode/task_queue.json"
        log_success "Created task queue file"
    fi
    
    log_success "Directories set up"
}

# 主逻辑
case "$1" in
    start)
        check_dependencies
        check_project_dir
        setup_directories
        start_automation
        ;;
    stop)
        stop_automation
        ;;
    restart)
        stop_automation
        sleep 2
        check_dependencies
        check_project_dir
        setup_directories
        start_automation
        ;;
    status)
        check_status
        ;;
    install)
        check_dependencies
        check_project_dir
        install_dependencies
        setup_directories
        log_success "Installation completed"
        ;;
    help|--help|-h)
        show_help
        ;;
    "")
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac