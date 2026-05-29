#!/usr/bin/env bash
# OpenCode Sidecar Benchmark Suite
# Usage: ./benchmark.sh [ipc|startup|all]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

run_ipc_bench() {
    echo "=== IPC Protocol Benchmark (criterion) ==="
    cargo bench --bench ipc_bench
}

run_startup_bench() {
    echo "=== Startup Benchmark (hyperfine) ==="
    cargo build --release

    if ! command -v hyperfine &>/dev/null; then
        echo "Installing hyperfine..."
        cargo install hyperfine
    fi

    local binary="target/release/opencode-sidecar"
    if [[ ! -f "$binary" ]]; then
        echo "ERROR: binary not found at $binary"
        exit 1
    fi

    # Cold start benchmark
    hyperfine \
        --warmup 3 \
        --min-runs 50 \
        --export-json "target/bench-startup.json" \
        "$binary --help"

    echo ""
    echo "Results saved to target/bench-startup.json"
}

run_memory_bench() {
    echo "=== Memory Benchmark ==="
    cargo build --release

    local binary="target/release/opencode-sidecar"

    # Start sidecar, measure RSS, then stop
    $binary &
    local pid=$!
    sleep 1

    if command -v /usr/bin/ps &>/dev/null; then
        echo "PID: $pid"
        /usr/bin/ps -o rss= -p $pid | awk '{print "RSS: " $1/1024 " MB"}'
    fi

    kill $pid 2>/dev/null || true
    wait $pid 2>/dev/null || true
}

case "${1:-all}" in
    ipc) run_ipc_bench ;;
    startup) run_startup_bench ;;
    memory) run_memory_bench ;;
    all)
        run_ipc_bench
        echo ""
        run_startup_bench
        echo ""
        run_memory_bench
        ;;
    *) echo "Usage: $0 [ipc|startup|memory|all]" ;;
esac
