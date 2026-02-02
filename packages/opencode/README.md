# opencode

OpenCode is an AI-powered coding agent built for the terminal.

## Installation

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Features

### DDD (Domain-Driven Design) Analysis and Code Generation

OpenCode provides a comprehensive DDD workflow for analyzing requirements and generating production-ready code. See [DDD_USAGE.md](./DDD_USAGE.md) for complete documentation.

**Quick Start:**

```bash
/ddd.init <project-name>      # Initialize DDD workspace
/ddd.ingest @requirements.md  # Import requirements
/ddd.strategic                # Strategic design
/ddd.tactical                 # Tactical design
/ddd.services                 # Service design
/ddd.implement                # Auto-generate code
```

**Supported Technologies:**

- TypeScript/Node.js (NestJS, Express)
- Java (Spring Boot)
- Python (FastAPI, Django)
- Go (Gin, Echo)

For detailed usage, see [DDD_USAGE.md](./DDD_USAGE.md).

This project was created using `bun init` in bun v1.2.12. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
