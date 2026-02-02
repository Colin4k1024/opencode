# DDD (Domain-Driven Design) Analysis and Code Generation

OpenCode provides a comprehensive DDD workflow that helps you:

1. Analyze requirements and create DDD design documents
2. Perform strategic and tactical DDD design
3. Automatically generate production-ready code from design documents

## Quick Start

OpenCode DDD workflow supports two modes: **Quick Mode** (integrated) and **Detailed Mode** (step-by-step).

### Quick Mode (Recommended for beginners)

```bash
# 1. Initialize DDD workspace
/ddd.init 电商系统

# 2. Import requirements
/ddd.ingest @requirements.md
# Or paste text, or provide URLs

# 3. Strategic design (generates or integrates from detailed docs)
/ddd.strategic

# 4. Tactical design (generates or integrates from detailed docs)
/ddd.tactical

# 5. Service design (generates or integrates from detailed docs)
/ddd.services

# 6. Generate complete design document
/ddd.design

# 7. Auto-generate code implementation
/ddd.implement
```

### Detailed Mode (Recommended for complex projects)

```bash
# 1. Initialize DDD workspace
/ddd.init 电商系统

# 2. Create/update DDD principles
/ddd.constitution

# 3. Import requirements
/ddd.ingest @requirements.md

# 4. Refine and validate requirements
/ddd.requirements

# 5. Strategic design (detailed steps)
/ddd.domains          # Domain analysis
/ddd.contexts         # Bounded contexts
/ddd.mapping          # Context mapping
/ddd.strategic         # Integrate strategic design

# 6. Tactical design (detailed steps)
/ddd.entities         # Entity design
/ddd.value-objects    # Value object design
/ddd.aggregates       # Aggregate design
/ddd.repositories     # Repository design
/ddd.events           # Domain event design
/ddd.tactical         # Integrate tactical design

# 7. Service design (detailed steps)
/ddd.app-services     # Application service design
/ddd.domain-services  # Domain service design
/ddd.boundaries       # Service boundary design
/ddd.services         # Integrate service design

# 8. Generate complete design document
/ddd.design

# 9. Auto-generate code implementation
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
- Creates initial `ddd-constitution.md` with DDD principles (if missing)

### `/ddd.constitution` - DDD Principles

Create or update DDD principles and design guidelines.

```bash
/ddd.constitution
```

**What it does:**

- Creates or updates `.opencode/ddd/ddd-constitution.md`
- Defines DDD strategic and tactical design principles
- Establishes design guidelines for the project

**Output:**

- `.opencode/ddd/ddd-constitution.md` - DDD principles and guidelines

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

### `/ddd.requirements` - Refine Requirements

Refine and validate requirements for DDD analysis.

```bash
/ddd.requirements
```

**What it does:**

- Validates requirement completeness
- Identifies domain boundary clues
- Prioritizes requirements
- Maps requirements to potential domains

**Output:**

- Updates `.opencode/ddd/designs/<projectId>/requirements.md` with refined requirements

### `/ddd.domains` - Domain Analysis

Perform domain analysis and classification.

```bash
/ddd.domains
```

**What it does:**

- Identifies core domains
- Identifies supporting domains
- Identifies generic domains
- Analyzes domain value

**Output:**

- `.opencode/ddd/designs/<projectId>/domains.md`

**Contains:**

- Core domain identification
- Supporting domains
- Generic domains
- Domain value analysis

### `/ddd.contexts` - Bounded Contexts

Define bounded contexts with boundaries and ubiquitous language.

```bash
/ddd.contexts
```

**What it does:**

- Identifies bounded contexts
- Defines context boundaries
- Establishes ubiquitous language
- Maps context responsibilities

**Output:**

- `.opencode/ddd/designs/<projectId>/contexts.md`

**Contains:**

- Bounded context definitions
- Context boundaries
- Ubiquitous language
- Context responsibilities

### `/ddd.mapping` - Context Mapping

Create context mapping showing relationships between bounded contexts.

```bash
/ddd.mapping
```

**What it does:**

- Identifies context relationships
- Defines relationship types (Partnership, Shared Kernel, Customer-Supplier, etc.)
- Maps upstream/downstream relationships
- Designs integration patterns

**Output:**

- `.opencode/ddd/designs/<projectId>/mapping.md`

**Contains:**

- Context map diagram (mermaid)
- Relationship types
- Integration patterns
- Strategic design decisions

### `/ddd.strategic` - Strategic Design Analysis

Perform strategic DDD design analysis.

```bash
/ddd.strategic
```

**What it does:**

- If detailed docs exist (`domains.md`, `contexts.md`, `mapping.md`): Integrates them into a complete strategic design
- If detailed docs don't exist: Generates complete strategic design directly (backward compatible)
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

### `/ddd.entities` - Entity Design

Design entities with identity, attributes, behaviors, and invariants.

```bash
/ddd.entities
```

**What it does:**

- Identifies entities
- Defines entity identity
- Designs entity attributes and behaviors
- Establishes entity invariants

**Output:**

- `.opencode/ddd/designs/<projectId>/entities.md`

### `/ddd.value-objects` - Value Object Design

Design value objects with immutability and validation.

```bash
/ddd.value-objects
```

**What it does:**

- Identifies value objects
- Defines value object attributes
- Establishes validation rules
- Ensures immutability

**Output:**

- `.opencode/ddd/designs/<projectId>/value-objects.md`

### `/ddd.aggregates` - Aggregate Design

Design aggregates with boundaries and invariants.

```bash
/ddd.aggregates
```

**What it does:**

- Identifies aggregates
- Defines aggregate roots
- Establishes aggregate boundaries
- Defines aggregate invariants

**Output:**

- `.opencode/ddd/designs/<projectId>/aggregates.md`

### `/ddd.repositories` - Repository Design

Design repository interfaces for aggregate persistence.

```bash
/ddd.repositories
```

**What it does:**

- Designs repository interfaces
- Defines query methods
- Establishes persistence strategies

**Output:**

- `.opencode/ddd/designs/<projectId>/repositories.md`

### `/ddd.events` - Domain Event Design

Design domain events with payloads and subscribers.

```bash
/ddd.events
```

**What it does:**

- Identifies domain events
- Designs event payloads
- Maps event subscribers
- Defines event publishing patterns

**Output:**

- `.opencode/ddd/designs/<projectId>/events.md`

### `/ddd.tactical` - Tactical Design Analysis

Perform tactical DDD design analysis.

```bash
/ddd.tactical
```

**What it does:**

- If detailed docs exist (`entities.md`, `value-objects.md`, `aggregates.md`, `repositories.md`, `events.md`): Integrates them into a complete tactical design
- If detailed docs don't exist: Generates complete tactical design directly (backward compatible)
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

### `/ddd.app-services` - Application Service Design

Design application services for use case orchestration.

```bash
/ddd.app-services
```

**What it does:**

- Identifies application services
- Designs use case orchestration
- Defines service interfaces

**Output:**

- `.opencode/ddd/designs/<projectId>/app-services.md`

### `/ddd.domain-services` - Domain Service Design

Design domain services with interfaces and dependencies.

```bash
/ddd.domain-services
```

**What it does:**

- Identifies domain services
- Designs service interfaces
- Maps service dependencies

**Output:**

- `.opencode/ddd/designs/<projectId>/domain-services-detailed.md`

### `/ddd.boundaries` - Service Boundary Design

Design service boundaries and integration points.

```bash
/ddd.boundaries
```

**What it does:**

- Defines service boundaries
- Maps service responsibilities
- Designs service interactions
- Identifies integration points

**Output:**

- `.opencode/ddd/designs/<projectId>/boundaries.md`

**Contains:**

- Service boundaries
- Service responsibilities
- Service interaction patterns
- Integration points
- Service dependency graph (mermaid)

### `/ddd.services` - Service Design

Perform domain service design and service boundary analysis.

```bash
/ddd.services
```

**What it does:**

- If detailed docs exist (`app-services.md`, `domain-services-detailed.md`, `boundaries.md`): Integrates them into a complete service design
- If detailed docs don't exist: Generates complete service design directly (backward compatible)
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

### Core Documents

- **requirements.md**: Structured requirements with REQ-### IDs
- **ddd-constitution.md**: DDD principles and design guidelines (in `.opencode/ddd/`)

### Strategic Design (Detailed)

- **domains.md**: Domain analysis (core, supporting, generic)
- **contexts.md**: Bounded context definitions
- **mapping.md**: Context mapping and relationships
- **strategic-design.md**: Integrated strategic design (generated from detailed docs)

### Tactical Design (Detailed)

- **entities.md**: Entity designs
- **value-objects.md**: Value object designs
- **aggregates.md**: Aggregate designs
- **repositories.md**: Repository interface designs
- **events.md**: Domain event designs
- **tactical-design.md**: Integrated tactical design (generated from detailed docs)

### Service Design (Detailed)

- **app-services.md**: Application service designs
- **domain-services-detailed.md**: Domain service designs
- **boundaries.md**: Service boundary designs
- **domain-services.md**: Integrated service design (generated from detailed docs)

### Final Document

- **ddd-design.md**: Complete DDD design document (summary)

## Best Practices

1. **Start with Requirements**: Always run `/ddd.ingest` first to establish requirements
2. **Choose Your Mode**:
   - Use **Quick Mode** for simple projects or when you want to generate everything at once
   - Use **Detailed Mode** for complex projects where you need step-by-step refinement
3. **Follow the Sequence**: Run commands in order
   - Quick Mode: init → ingest → strategic → tactical → services → design → implement
   - Detailed Mode: Follow the detailed workflow above
4. **Iterate on Design**: You can run individual detailed commands to refine specific aspects
5. **Integration Commands**: The integration commands (`/ddd.strategic`, `/ddd.tactical`, `/ddd.services`) will automatically use detailed docs if they exist, or generate complete designs if they don't
6. **Review Design Documents**: Review generated design documents before implementing
7. **Use Ubiquitous Language**: Ensure consistent terminology across all documents
8. **Trace Requirements**: Reference REQ-### IDs in design decisions

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
