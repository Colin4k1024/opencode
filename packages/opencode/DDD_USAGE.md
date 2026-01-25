# DDD (Domain-Driven Design) Analysis and Code Generation

OpenCode provides a comprehensive DDD workflow that helps you:
1. Analyze requirements and create DDD design documents
2. Perform strategic and tactical DDD design
3. Automatically generate production-ready code from design documents

## Quick Start

```bash
# 1. Initialize DDD workspace
/ddd.init 电商系统

# 2. Import requirements
/ddd.ingest @requirements.md
# Or paste text, or provide URLs

# 3. Strategic design
/ddd.strategic

# 4. Tactical design
/ddd.tactical

# 5. Service design
/ddd.services

# 6. Generate complete design document
/ddd.design

# 7. Auto-generate code implementation
/ddd.implement
```

## Commands

### `/ddd.init` - Initialize DDD Workspace

Initialize a new DDD project workspace.

```bash
/ddd.init <project-name> [--branch]
```

**Examples:**
```bash
/ddd.init 电商系统
/ddd.init 001-order-management --branch
```

**What it does:**
- Creates `.opencode/ddd/` directory structure
- Creates `context.json` with project metadata
- Optionally creates and switches to a git branch
- Creates initial `ddd-constitution.md` with DDD principles

### `/ddd.ingest` - Import Requirements

Import requirement documents from files, URLs, or pasted text.

```bash
/ddd.ingest @requirements.md
/ddd.ingest https://example.com/requirements.md
/ddd.ingest [paste your requirements here]
```

**What it does:**
- Fetches documents from URLs
- Reads local files
- Accepts pasted text
- Creates structured `requirements.md` with REQ-### IDs
- Creates `sources.md` tracking all requirement sources

**Output:**
- `.opencode/ddd/inputs/sources.md` - Source index
- `.opencode/ddd/designs/<projectId>/requirements.md` - Structured requirements

### `/ddd.strategic` - Strategic Design Analysis

Perform strategic DDD design analysis.

```bash
/ddd.strategic
```

**What it does:**
- Analyzes domain boundaries
- Identifies bounded contexts
- Creates context mapping
- Classifies domains (core, supporting, generic)

**Output:**
- `.opencode/ddd/designs/<projectId>/strategic-design.md`

**Contains:**
- Domain analysis
- Bounded contexts with ubiquitous language
- Context mapping diagram (mermaid)
- Strategic design decisions

### `/ddd.tactical` - Tactical Design Analysis

Perform tactical DDD design analysis.

```bash
/ddd.tactical
```

**What it does:**
- Designs entities with identity and behaviors
- Defines value objects
- Creates aggregates with boundaries
- Identifies domain services
- Designs repository interfaces
- Defines domain events

**Output:**
- `.opencode/ddd/designs/<projectId>/tactical-design.md`

**Contains:**
- Entities with attributes, behaviors, invariants
- Value objects with validation
- Aggregates with boundaries
- Domain services
- Repository interfaces
- Domain events

### `/ddd.services` - Service Design

Perform domain service design and service boundary analysis.

```bash
/ddd.services
```

**What it does:**
- Designs application services
- Defines domain service interfaces
- Maps service dependencies
- Creates service boundaries

**Output:**
- `.opencode/ddd/designs/<projectId>/domain-services.md`

**Contains:**
- Application services with operations
- Domain service interfaces
- Service dependency graph (mermaid)
- Service boundary definitions

### `/ddd.design` - Generate Complete Design Document

Generate a comprehensive DDD design document synthesizing all artifacts.

```bash
/ddd.design
```

**What it does:**
- Combines all design documents
- Creates executive summary
- Ensures consistency across documents
- Generates requirements traceability matrix

**Output:**
- `.opencode/ddd/designs/<projectId>/ddd-design.md`

### `/ddd.implement` - Auto-Generate Code

Automatically generate complete code implementation from DDD design documents.

```bash
/ddd.implement
```

**What it does:**
1. Reads and parses all DDD design documents
2. Detects project technology stack (TypeScript, Java, Python, Go)
3. Generates complete code structure:
   - Domain layer (entities, value objects, aggregates, domain services, repositories, events)
   - Application layer (application services, DTOs, handlers)
   - Infrastructure layer (repository implementations, database mappings, external clients)
   - Interface layer (REST controllers, GraphQL resolvers, message handlers)
4. Generates comprehensive test code
5. Compiles and tests the generated code
6. Automatically fixes errors

**Supported Technologies:**
- **TypeScript/Node.js**: NestJS, Express, TypeORM, Prisma, Drizzle
- **Java**: Spring Boot, Hibernate, JPA
- **Python**: FastAPI, Django, Flask, SQLAlchemy
- **Go**: Gin, Echo, Fiber, GORM

**Output:**
- Complete code structure organized by bounded contexts
- All layers of DDD architecture
- Unit and integration tests
- Production-ready code

## Workflow Example

### Complete DDD Workflow

```bash
# Step 1: Initialize
/ddd.init 订单管理系统

# Step 2: Import requirements
/ddd.ingest @docs/requirements.md

# Step 3: Strategic design
/ddd.strategic

# Step 4: Tactical design  
/ddd.tactical

# Step 5: Service design
/ddd.services

# Step 6: Review complete design
/ddd.design

# Step 7: Generate code
/ddd.implement
```

## Project Structure

After running `/ddd.implement`, your project will have a structure like:

### TypeScript/NestJS Example

```
src/
├── order-management/          # Bounded Context
│   ├── domain/
│   │   ├── entities/
│   │   │   └── order.entity.ts
│   │   ├── value-objects/
│   │   │   └── money.vo.ts
│   │   ├── aggregates/
│   │   │   └── order.aggregate.ts
│   │   ├── services/
│   │   │   └── order-pricing.service.ts
│   │   ├── repositories/
│   │   │   └── order.repository.ts
│   │   └── events/
│   │       └── order-placed.event.ts
│   ├── application/
│   │   ├── services/
│   │   │   └── order-application.service.ts
│   │   └── dto/
│   │       ├── commands/
│   │       └── queries/
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   └── order.repository.impl.ts
│   │   └── external/
│   └── interfaces/
│       └── rest/
│           └── order.controller.ts
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

### Java/Spring Boot Example

```
src/main/java/com/example/
└── ordermanagement/
    ├── domain/
    │   ├── model/
    │   │   ├── Order.java
    │   │   └── Money.java
    │   ├── service/
    │   ├── repository/
    │   └── event/
    ├── application/
    │   ├── service/
    │   └── dto/
    ├── infrastructure/
    │   └── persistence/
    └── interfaces/
        └── rest/
```

## Design Document Structure

All design documents are stored in `.opencode/ddd/designs/<projectId>/`:

- **requirements.md**: Structured requirements with REQ-### IDs
- **strategic-design.md**: Domain analysis, bounded contexts, context mapping
- **tactical-design.md**: Entities, value objects, aggregates, domain services
- **domain-services.md**: Application services, service boundaries
- **ddd-design.md**: Complete design document (summary)

## Best Practices

1. **Start with Requirements**: Always run `/ddd.ingest` first to establish requirements
2. **Follow the Sequence**: Run commands in order (init → ingest → strategic → tactical → services → design → implement)
3. **Review Design Documents**: Review generated design documents before implementing
4. **Iterate on Design**: Refine design documents as needed before code generation
5. **Use Ubiquitous Language**: Ensure consistent terminology across all documents
6. **Trace Requirements**: Reference REQ-### IDs in design decisions

## Tips

- Use `--branch` flag with `/ddd.init` to create a feature branch
- You can re-run design commands to refine the design
- Code generation respects existing project structure and conventions
- Generated code includes comprehensive tests
- All code follows DDD principles strictly

## Troubleshooting

**Q: Command says design document is missing**
A: Run the prerequisite commands first. Check `.opencode/ddd/designs/<projectId>/` for existing documents.

**Q: Code generation fails**
A: Check that all design documents are complete. The implement command requires strategic-design.md, tactical-design.md, and domain-services.md.

**Q: Generated code doesn't compile**
A: The implement command automatically fixes compilation errors. If issues persist after 3 attempts, check the error messages for manual intervention.

**Q: How to customize generated code structure?**
A: The code generator follows existing project conventions. Ensure your project has a clear structure before running `/ddd.implement`.

## See Also

- [DDD Principles](https://martinfowler.com/bliki/DomainDrivenDesign.html)
- [OpenCode Commands Documentation](/docs/commands)
- [OpenCode Agents Documentation](/docs/agents)
