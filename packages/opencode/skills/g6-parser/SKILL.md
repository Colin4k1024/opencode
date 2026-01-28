---
name: g6-parser
description: Parse and hierarchically decompose G6 JSON design files for incremental processing, avoiding prompt explosion
---

# G6 Parser Skill

## Overview

This skill provides methods to parse and hierarchically decompose large G6 JSON files, avoiding prompt explosion by processing incrementally. Use this skill when working with G6 JSON design files to extract information in a structured, layered approach.

## G6 JSON Structure

G6 JSON files contain three main sections:

### Combos
Module/group definitions that organize nodes:
- `id`: Unique combo identifier
- `label`: Human-readable name
- `nodeType`: Type of combo (e.g., `service-layer`, `object-area`)
- `comboId`: Parent combo (for nested combos)
- `data.description`: Description of the module

### Nodes
Individual design elements:
- `id`: Unique node identifier
- `label`: Human-readable name
- `nodeType`: Type of node (e.g., `value-object`, `business-object`, `interface`, `mapper-interface`, `event-listener`)
- `comboId`: Which combo/module this node belongs to
- `data`: Node-specific data (varies by nodeType)

### Edges
Relationships between nodes:
- `id`: Unique edge identifier
- `source`: Source node ID
- `target`: Target node ID
- `edgeType`: Type of relationship (e.g., `cardinality-relationship`, `parameter-reference`, `inclusion-relation`)
- `data`: Edge-specific data

## Hierarchical Decomposition Methods

### Level 1: Overview Extraction

Extract high-level summary without loading full node/edge data.

**Steps:**
1. Read G6 JSON file (use `read` tool, may need to read in chunks for very large files)
2. Extract combos summary:
   ```bash
   # Using jq (if available) or parse with read tool
   # Extract: id, label, nodeType, data.description for each combo
   ```
3. Count nodes by type:
   - Group nodes by `nodeType`
   - Count occurrences of each type
4. Count edges by type:
   - Group edges by `edgeType`
   - Count occurrences of each type
5. Generate overview summary

**Output Format:**
```json
{
  "combos": [
    {"id": "...", "label": "...", "nodeType": "...", "description": "..."}
  ],
  "nodeStats": [
    {"type": "value-object", "count": 10},
    {"type": "business-object", "count": 5},
    ...
  ],
  "edgeStats": [
    {"type": "cardinality-relationship", "count": 20},
    ...
  ],
  "totalNodes": 100,
  "totalEdges": 150
}
```

**When to use:** Always start here to understand the overall structure before diving into details.

### Level 2: Module-Level Parsing

Parse nodes and edges within a specific combo/module.

**Steps:**
1. Select target combo ID
2. Extract nodes in this combo:
   - Filter nodes where `comboId == targetComboId`
   - Extract: `id`, `label`, `nodeType` (minimal data)
3. Extract related edges:
   - Edges where `source` or `target` is in this combo
   - Extract: `id`, `source`, `target`, `edgeType`
4. Analyze module dependencies:
   - Find edges connecting to nodes outside this combo
   - Identify external dependencies
5. Generate module summary

**Output Format:**
```json
{
  "comboId": "service-layer-lzxt",
  "nodes": [
    {"id": "...", "label": "...", "nodeType": "..."}
  ],
  "nodeTypeDistribution": {...},
  "internalEdges": [...],
  "externalDependencies": [
    {"nodeId": "...", "dependsOn": "..."}
  ]
}
```

**When to use:** After overview, to understand a specific module's structure before processing its nodes.

### Level 3: Node-Type Parsing

Extract all nodes of a specific type across the entire file or within a module.

**Steps:**
1. Select target node type (e.g., `value-object`)
2. Optionally filter by combo ID
3. Extract nodes of this type:
   - Filter by `nodeType == targetType`
   - Extract: `id`, `label`, `nodeType`, `comboId`, minimal `data`
4. Find related edges:
   - Edges where source or target is in this node set
5. Analyze dependencies:
   - Which nodes depend on these nodes
   - Which nodes these nodes depend on
6. Generate node-type summary

**Output Format:**
```json
{
  "nodeType": "value-object",
  "nodes": [
    {"id": "...", "label": "...", "comboId": "...", "data": {...}}
  ],
  "dependencies": {
    "dependsOn": [...],
    "dependedBy": [...]
  }
}
```

**When to use:** To process all nodes of a specific type together (e.g., all value-objects before business-objects).

### Level 4: Deep Node Analysis

Extract complete information for a specific node, including all related edges and dependencies.

**Steps:**
1. Select target node ID
2. Load complete node data:
   - Find node by ID
   - Extract full `data` object
3. Find all related edges:
   - Edges where `source == nodeId` (outgoing)
   - Edges where `target == nodeId` (incoming)
4. Analyze dependencies:
   - Nodes this node depends on (via incoming edges)
   - Nodes that depend on this node (via outgoing edges)
5. Generate implementation requirements:
   - Based on nodeType, extract relevant data fields
   - Identify required dependencies
   - Generate code generation specifications

**Output Format:**
```json
{
  "node": {
    "id": "...",
    "label": "...",
    "nodeType": "...",
    "comboId": "...",
    "data": {...}
  },
  "outgoingEdges": [...],
  "incomingEdges": [...],
  "dependencies": {
    "requires": ["nodeId1", "nodeId2"],
    "requiredBy": ["nodeId3"]
  },
  "implementationRequirements": {
    "type": "...",
    "specifications": {...}
  }
}
```

**Saving to file:** When saving to `.opencode/g6/<projectId>/nodes/<nodeId>.json`, the **file content** must be the full Level 4 output as a JSON string (same shape as above). The file must **not** be empty. Use the write tool with `content` set to that JSON string.

**When to use:** Level 4 has two main use cases:

1. **Parser Agent Phase 4 (MANDATORY)**: When parsing a G6 JSON file, the parser agent MUST use Level 4 to process ALL nodes in batch. This is a required phase where:
   - All nodes are processed systematically (one by one)
   - Complete node data is extracted for each node
   - Each node's detailed data is saved to `.opencode/g6/<projectId>/nodes/<nodeId>.json`. The content of each node file must be the complete Level 4 JSON; never write an empty or placeholder file.
   - This ensures all node information is cached before task generation and implementation planning
   - **This phase cannot be skipped** - it's mandatory for the parser workflow

2. **Implementation Stage (On-Demand)**: When implementing a specific node, load its complete details on demand:
   - Read the cached node data from `.opencode/g6/<projectId>/nodes/<nodeId>.json` if it exists
   - If not cached, use Level 4 method to extract the node details from the G6 JSON file
   - Use the complete node data to guide implementation

## Incremental Loading Strategy

### Principle: Load Only What You Need

Instead of loading the entire G6 JSON file into context:

1. **Start with overview** (Level 1) - minimal data
2. **Load modules incrementally** (Level 2) - one module at a time
3. **Load node types as needed** (Level 3) - when processing a specific type
4. **Load node details** (Level 4) - two scenarios:
   - **Parser Phase 4 (MANDATORY)**: Batch process ALL nodes and save to cache
   - **Implementation stage**: Load individual node details on demand when implementing

### Caching Strategy

Cache parsed results to avoid re-parsing:

**Cache Directory Structure:**
```
.opencode/g6/
└── <projectId>/
    ├── overview.json          # Level 1 output
    ├── modules/
    │   ├── <comboId>.json    # Level 2 output per module
    │   └── ...
    ├── node-types/
    │   ├── <nodeType>.json   # Level 3 output per type
    │   └── ...
    └── nodes/
        ├── <nodeId>.json      # Level 4 output per node
        └── ...
```

**Benefits:**
- Avoid re-parsing large files
- Enable incremental updates
- Support parallel processing

### Tools for Parsing

**Option 1: Using read tool with line ranges**
- For very large files, read specific sections
- Use `grep` to find line numbers of specific patterns
- Read only the needed sections

**Option 2: Using bash with jq (if available)**
- `jq` is a powerful JSON processor
- Can extract specific fields efficiently
- Can filter and transform JSON

**Option 3: Using bash with custom scripts**
- Write simple parsing scripts
- Use standard JSON parsing tools
- Extract and cache results

## Phased Processing Workflow

### Phase 1: Overview Analysis

**Goal:** Understand the overall structure

**Steps:**
1. Load `g6-parser` skill using `skill` tool
2. Use Level 1 method to extract overview
3. Review combos, node statistics, edge statistics
4. Identify main modules and their relationships

**Output:** Overview summary with module list and statistics

### Phase 2: Module Planning

**Goal:** Plan which modules to process and in what order

**Steps:**
1. Review overview to identify modules
2. Analyze module dependencies (from overview)
3. Determine processing order (dependencies first)
4. Select modules to process (can be all or subset)

**Output:** Module processing plan with order

### Phase 3: Module Processing

**Goal:** Process each module incrementally

**For each module:**
1. Use Level 2 method to extract module structure
2. Analyze module's node types and dependencies
3. Within module, use Level 3 to group by node type
4. Determine node processing order (topological sort)

**Output:** Per-module node list with processing order

### Phase 4: Task Generation

**Goal:** Generate implementation tasks

**For each node (in dependency order):**
1. Use Level 4 method to load node details
2. Analyze implementation requirements
3. Check dependency status
4. Generate task description

**Output:** Ordered task list ready for coding agent

### Phase 5: Incremental Implementation

**Goal:** Implement code incrementally

**For each task:**
1. Load node details (Level 4) if not already loaded
2. Call coding agent with task description
3. Monitor implementation progress
4. Move to next task

**Output:** Implemented code for each node

## Integration with g6-parser Agent

### How Agent Should Use This Skill

1. **Load skill first:**
   ```
   Use skill tool: skill("g6-parser")
   ```

2. **Follow phased workflow:**
   - Phase 1: Overview (Level 1)
   - Phase 2: Module Planning
   - Phase 3: Module Processing (Level 2, then Level 3) - collect all node IDs
   - Phase 4: Task Generation (Level 4) - **MANDATORY**: Process ALL nodes and save to cache
   - Phase 5: Implementation

3. **Use incremental loading:**
   - Never load entire G6 JSON at once
   - Load only current phase's data
   - Cache results for reuse

4. **Handle large files:**
   - For files > 10MB, use read with line ranges
   - Use grep to locate specific sections
   - Parse incrementally

## Example Workflows

### Workflow 1: Extract Overview

```bash
# Step 1: Load skill
skill("g6-parser")

# Step 2: Read G6 JSON file (first 100 lines to find structure)
read("design/g6/merged-output-23-01.json", offset=1, limit=100)

# Step 3: Extract combos (use grep to find combo section)
grep('"combos"', "design/g6/merged-output-23-01.json")

# Step 4: Read combo section and extract summary
# Use read with appropriate line range or use bash+jq if available
```

### Workflow 2: Process a Module

```bash
# Step 1: Load skill (if not already loaded)
skill("g6-parser")

# Step 2: Extract module nodes
# Use grep to find nodes with specific comboId
grep('"comboId" : "service-layer-lzxt"', "design/g6/merged-output-23-01.json")

# Step 3: Read relevant sections
# Extract node IDs and basic info

# Step 4: Analyze module dependencies
# Find edges connecting to/from this module
```

### Workflow 3: Deep Node Analysis

```bash
# Step 1: Load skill
skill("g6-parser")

# Step 2: Find node by ID
grep('"id" : "business-entity-handover-config"', "design/g6/merged-output-23-01.json")

# Step 3: Read node section with context
# Read surrounding lines to get full node data

# Step 4: Find related edges
grep('"source" : "business-entity-handover-config"', "design/g6/merged-output-23-01.json")
grep('"target" : "business-entity-handover-config"', "design/g6/merged-output-23-01.json")

# Step 5: Analyze and generate implementation requirements
```

## Best Practices

1. **Always start with overview** - Don't skip Level 1
2. **Process incrementally** - One module at a time
3. **Cache results** - Save parsed data to avoid re-parsing
4. **Use appropriate level** - Don't load Level 4 data when Level 2 is sufficient, EXCEPT in parser Phase 4 where Level 4 is mandatory for all nodes
5. **Handle large files** - Use line ranges and grep for very large files
6. **Validate structure** - Check JSON structure before parsing
7. **Parser Phase 4 is mandatory** - In parser agent workflow, Phase 4 MUST process ALL nodes using Level 4 and save them to cache

## Common Patterns

### Pattern 1: Extract All Value Objects First

```bash
# Use Level 3 method
# Filter nodes where nodeType == "value-object"
# Extract and cache
# Process before business-objects (they depend on value-objects)
```

### Pattern 2: Process Module by Dependency Order

```bash
# Use Level 2 to get module dependencies
# Topological sort modules
# Process in dependency order
```

### Pattern 3: Batch Process by Node Type

```bash
# Within a module, group by nodeType
# Process all value-objects, then business-objects, etc.
# Use Level 3 for each type
```

## Error Handling

- **Invalid JSON**: Report parsing errors clearly
- **Missing nodes**: Handle gracefully, report missing dependencies
- **Circular dependencies**: Detect and report, suggest resolution
- **Large file issues**: Use incremental reading strategies
