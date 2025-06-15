#!/bin/bash

# 并发性能测试启动脚本
# 用于测试Binance Volume Backtest服务的并发处理能力

set -e

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

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
    log_info "检查系统依赖..."
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js未安装，请先安装Node.js"
        exit 1
    fi
    
    # 检查yarn
    if ! command -v yarn &> /dev/null; then
        log_error "Yarn未安装，请先安装Yarn"
        exit 1
    fi
    
    # 检查axios
    if ! node -e "require('axios')" 2>/dev/null; then
        log_warning "axios未安装，正在安装..."
        yarn add axios
    fi
    
    log_success "依赖检查完成"
}

# 检查服务状态
check_service() {
    log_info "检查后端服务状态..."
    
    local max_attempts=5
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "http://localhost:4001/v1/binance/volume-backtest/test-connection" > /dev/null 2>&1; then
            log_success "后端服务运行正常"
            return 0
        else
            log_warning "服务连接失败，尝试 $attempt/$max_attempts"
            sleep 2
            ((attempt++))
        fi
    done
    
    log_error "无法连接到后端服务 (http://localhost:4001)"
    log_error "请确保后端服务正在运行："
    echo "  1. cd research-dashboard-backend"
    echo "  2. yarn start:dev"
    exit 1
}

# 启动服务（如果需要）
start_service() {
    if [ "$1" = "--start-service" ]; then
        log_info "启动后端服务..."
        
        # 检查是否已有服务在运行
        if lsof -Pi :4001 -sTCP:LISTEN -t >/dev/null; then
            log_warning "端口4001已被占用，跳过服务启动"
        else
            # 后台启动服务
            log_info "在后台启动NestJS服务..."
            cd "$(dirname "$0")/.."
            nohup yarn start:dev > service.log 2>&1 &
            SERVICE_PID=$!
            echo $SERVICE_PID > service.pid
            
            log_info "服务启动中，PID: $SERVICE_PID"
            log_info "等待服务就绪..."
            sleep 10
            
            # 返回脚本目录
            cd "$(dirname "$0")"
        fi
    fi
}

# 停止服务
stop_service() {
    if [ -f "../service.pid" ]; then
        local pid=$(cat ../service.pid)
        if ps -p $pid > /dev/null 2>&1; then
            log_info "停止后端服务 (PID: $pid)..."
            kill $pid
            rm -f ../service.pid
            log_success "服务已停止"
        fi
    fi
}

# 运行并发测试
run_concurrent_test() {
    local test_type="$1"
    
    log_info "开始并发性能测试..."
    echo "=========================================="
    echo "🚀 Binance Volume Backtest 并发性能测试"
    echo "=========================================="
    echo "测试时间: $(date)"
    echo "测试类型: $test_type"
    echo "=========================================="
    
    cd "$(dirname "$0")/.."
    
    case $test_type in
        "basic")
            log_info "执行基础并发测试..."
            node tests/concurrent-performance.test.js
            ;;
        "full")
            log_info "执行完整并发测试（包括长时间测试）..."
            node tests/concurrent-performance.test.js --full
            ;;
        "quick")
            log_info "执行快速测试..."
            node -e "
            const ConcurrentTester = require('./tests/concurrent-performance.test.js');
            const tester = new ConcurrentTester();
            
            async function quickTest() {
                console.log('📋 快速并发测试开始...');
                
                // 只测试API连接和基础筛选
                const connectionOk = await tester.testApiConnection();
                if (connectionOk) {
                    const filterResult = await tester.testConcurrentFiltering();
                    console.log('✅ 快速测试完成');
                    console.log('结果:', filterResult.success ? '成功' : '失败');
                    if (filterResult.success) {
                        console.log('吞吐量:', filterResult.throughput.toFixed(1), '个/秒');
                        console.log('有效率:', filterResult.validRate + '%');
                    }
                } else {
                    console.log('❌ 连接测试失败');
                }
            }
            
            quickTest().catch(console.error);
            "
            ;;
        *)
            log_error "未知的测试类型: $test_type"
            show_usage
            exit 1
            ;;
    esac
}

# 显示使用说明
show_usage() {
    echo "用法: $0 [选项] [测试类型]"
    echo ""
    echo "测试类型:"
    echo "  quick    - 快速测试（仅API连接和筛选，约1分钟）"
    echo "  basic    - 基础测试（包括小规模回测，约5分钟）"
    echo "  full     - 完整测试（包括长时间回测，约15分钟）"
    echo ""
    echo "选项:"
    echo "  --start-service    自动启动后端服务"
    echo "  --stop-service     测试后停止服务"
    echo "  --help, -h         显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0 quick                      # 快速测试"
    echo "  $0 basic --start-service      # 启动服务并运行基础测试"
    echo "  $0 full --stop-service        # 完整测试后停止服务"
}

# 清理函数
cleanup() {
    log_info "清理临时文件..."
    if [ "$STOP_SERVICE_ON_EXIT" = "true" ]; then
        stop_service
    fi
}

# 设置清理trap
trap cleanup EXIT

# 主函数
main() {
    local test_type="basic"
    local start_service_flag=false
    local stop_service_flag=false
    
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --start-service)
                start_service_flag=true
                shift
                ;;
            --stop-service)
                stop_service_flag=true
                export STOP_SERVICE_ON_EXIT=true
                shift
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            quick|basic|full)
                test_type="$1"
                shift
                ;;
            *)
                log_error "未知参数: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # 执行测试流程
    log_info "开始并发性能测试流程..."
    
    check_dependencies
    
    if [ "$start_service_flag" = true ]; then
        start_service --start-service
    fi
    
    check_service
    
    run_concurrent_test "$test_type"
    
    log_success "并发性能测试完成！"
    
    # 显示测试结果文件
    local result_files=$(ls performance-test-*.json 2>/dev/null | tail -1)
    if [ -n "$result_files" ]; then
        log_info "详细测试结果文件: $result_files"
        log_info "查看结果: cat $result_files | jq ."
    fi
}

# 检查是否作为脚本直接运行
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi