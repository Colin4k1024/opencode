---
name: ddd-to-g6-with-docx
description: Parses a product-asset template docx (e.g. 产品资产模版) for G6/product-asset requirements, then maps full DDD domain analysis from .opencode/ddd/designs to G6 JSON (design.json with combos, nodes, edges). Use when the user provides a docx template path and DDD design path or projectId and wants G6 design.json that conforms to both the docx spec and the g6-parser schema.
---

# DDD to G6 with Docx Template

## When to Use

Apply this skill when:

- The user provides a **docx product-asset template** path (e.g. 产品资产模版) that defines G6/product-asset requirements.
- The user provides **DDD design artifacts** (path like `.opencode/ddd/designs/<projectId>/` or a project root containing `.opencode/ddd/`).
- The desired output is **G6 JSON** at `.opencode/g6/<projectId>/design.json` that conforms to the docx requirements and the g6-parser schema.

## Prerequisites

- **Docx parsing**: Use the [docx](../docx/SKILL.md) skill (e.g. pandoc to markdown, or unpack for raw XML); do not read .docx files with the read tool (they are binary).
- **G6 output schema**: Follow [g6-parser](../g6-parser/SKILL.md) — output must have top-level `combos`, `nodes`, `edges`.
- **DDD → G6 mapping**: Apply the mapping defined in the ddd-to-g6 agent prompt (see `packages/opencode/src/agent/prompt/ddd-to-g6.txt`). Output must follow the **same structure and data richness** as the reference design (e.g. merged-output-23-01.json): exact `data` shapes for each combo and nodeType (properties, endpoint, requestType, method, parameters.requestRef/responseRef for interface and mapper-interface; properties with full field schema for business-object, general-object, request-object, response-object; eventConfig, eventDefinition, etc.). When generating design.json, read **DDD_TO_G6_SCHEMA.md** (this skill directory) for the condensed schema and mapping table.

## Workflow

### Step 1: Parse the docx (G6/product-asset spec)

1. Resolve **projectId** first (read `.opencode/ddd/context.json` or list `.opencode/ddd/designs/`) so you can write the converted output under the project.
2. **Do not use the read tool on the .docx file** — .docx is binary and will error ("Cannot read binary file"). Use the **docx skill** to parse/read the docx: the docx skill is in the user's skills directory (e.g. `~/.cursor/skills/docx/SKILL.md` or `skills/docx/SKILL.md`); read its SKILL.md and follow its "Reading Content" or conversion steps (pandoc, mammoth, or unpack).
3. Convert the docx to markdown (e.g. `pandoc document.docx -o .opencode/g6/<projectId>/_product-asset-converted.md`, or use mammoth via bash if available). **Write the output to `.opencode/g6/<projectId>/_product-asset-converted.md`** (create the directory if needed) so the read tool can read it. Do **not** write to `/tmp` — the agent may not be allowed to read files there. Then **read** the generated `.opencode/g6/<projectId>/_product-asset-converted.md` file to get the product-asset spec in context.
4. From the converted markdown, extract the **G6/product-asset specification**:
   - Required structure: e.g. overall interaction, layout assets (menu, settings), page assets (pages with module, interface, data, layout, interactionLogic).
   - Field semantics and conventions (page id format, interface naming, 产品资产 sections).
5. Optionally: if the user wants a `product-assets.json` file, run product-asset.extract on the docx first and use that JSON for alignment; otherwise treat the parsed docx content as the spec for alignment.

### Step 2: Resolve projectId and read DDD artifacts

1. Resolve **projectId**:
   - Read `.opencode/ddd/context.json` for projectId or current design id, or
   - List `.opencode/ddd/designs/` and use the single (or user-specified) project directory name.
2. Read **all** artifact files **in full** from `.opencode/ddd/designs/<projectId>/`; include any file under `inputs/` (e.g. sources.md). Artifacts: requirements.md, domains.md, contexts.md, mapping.md, strategic-design.md, entities.md, value-objects.md, aggregates.md, repositories.md, events.md, tactical-design.md, app-services.md, domain-services-detailed.md, boundaries.md, domain-services.md, ddd-design.md.
3. If an artifact is missing, infer from others or omit that part of the graph; still produce valid G6 JSON.

### Step 3: Hierarchical G6 generation (combo → node → edge)

Do **not** build combos, nodes, and edges in one step. Generate and write **one layer at a time**, then read the written file for the next phase.

**3a. Phase 1 — Combos only**

1. **Obtain interface and page lists from product-asset first**: From the parsed docx or product-assets.json, extract the list of pages (pageAssets) and the list of interfaces per page/use-case (e.g. list, search, detail, toggle, save, export, my-task-*, receiver-*). Use these as the source of truth for **frontend-interface** node ids (format `frontend-interface-<slug>`) and **pages** node ids (format `page-<slug>`). Resolve service short name from product-asset or context for combo ids (`service-layer-<shortName>`, `object-area-<shortName>`, `page-layer-<shortName>`). For handover/separation projects (projectId or context containing separation or handover), **default service short name to lzxt**, so combos use service-layer-lzxt, object-area-lzxt, page-layer-lzxt.
2. From DDD (contexts.md, mapping.md, strategic-design.md) and product-asset layout, derive **only** the **combos** array (scode-layer, service-layer-&lt;shortName&gt;, object-area, page-layer, bpms-process-area, hpc-area, pages). Do not generate nodes or edges.
3. **Before writing**: Remove from combos any entry with nodeType event-listener or status-transition; those must be nodes only.
4. Ensure `.opencode/g6/<projectId>/` exists. Write the combos array to `.opencode/g6/<projectId>/design-combos.json`.

**3b. Phase 2 — Nodes only**

1. **Read** `.opencode/g6/<projectId>/design-combos.json` to get all combo ids.
2. Using DDD artifacts and product-asset, generate **only** the **nodes** array. Every node's `comboId` must be one of the combo ids from design-combos.json. Apply DDD mapping (as in ddd-to-g6):
   - Entities / aggregates → `business-object` nodes.
   - Value objects → `value-object` nodes.
   - **Repositories** → List **each method** in repositories.md (insert, update, delete, selectByXxx). For each method create a mapper-interface node and **create and add** the corresponding request-object-mapper-* and response-object-mapper-* nodes; write all into nodes.
   - Application services / API boundaries → align to product-asset interface list; create **frontend-interface** nodes; for each interface, **create and add** the **request-object** and **response-object** nodes referenced by parameters.requestRef/responseRef, with full `data.properties` (from boundaries.md / DTOs).
   - Domain events / handlers → `event-listener` nodes; use domain event type string (e.g. handover.task.confirmed) for eventConfig.eventType.
   - Processes/workflows from requirements → `bpms-process` nodes; triggers → `bpms-start-step` (comboId may be frontend-interface or process-area).
   - **Request/response completion**: Ensure every requestRef/responseRef has a corresponding request-object or response-object node; add any missing nodes with data.properties. Populate every node **data** with detailed content from DDD (see ddd-to-g6 prompt "Detail to include in G6"). Do **not** generate edges.
3. Write the nodes array to `.opencode/g6/<projectId>/design-nodes.json`.

**3c. Phase 3 — Edges only**

1. **Read** `.opencode/g6/<projectId>/design-nodes.json` to get all node ids (and nodeTypes).
2. Using DDD (aggregates, entities, app-services, events, requirements), generate **only** the **edges** array. Every edge `source` and `target` must be node ids from design-nodes.json. Apply: aggregate contains entity → inclusion-relation; entity–entity / entity–VO → cardinality-relationship or parameter-reference; app service invokes repo/domain service → interface-invoke; process/step relations → normal-relation or condition-flow. Do not modify combos or nodes.
3. Write the edges array to `.opencode/g6/<projectId>/design-edges.json`.

### Step 4: Merge to design.json

1. From the **project root**, run the merge command (see ddd-to-g6 agent prompt Phase 4). Replace `<projectId>` with the resolved projectId. **Bun**: `bun -e "const p='.opencode/g6/<projectId>'; const c=JSON.parse(await Bun.file(p+'/design-combos.json').text()); const n=JSON.parse(await Bun.file(p+'/design-nodes.json').text()); const e=JSON.parse(await Bun.file(p+'/design-edges.json').text()); await Bun.write(p+'/design.json', JSON.stringify({combos:c,nodes:n,edges:e}, null, 2));"` **Node**: `node -e "const fs=require('fs');const p='.opencode/g6/<projectId>';const c=JSON.parse(fs.readFileSync(p+'/design-combos.json','utf8'));const n=JSON.parse(fs.readFileSync(p+'/design-nodes.json','utf8'));const e=JSON.parse(fs.readFileSync(p+'/design-edges.json','utf8'));fs.writeFileSync(p+'/design.json',JSON.stringify({combos:c,nodes:n,edges:e},null,2));"`
2. Do not edit application source or DDD artifacts; only read inputs and write under `.opencode/g6/<projectId>/`.

## Output format

The file `.opencode/g6/<projectId>/design.json` must be a single JSON object:

```json
{
  "combos": [
    {
      "id": "unique-combo-id",
      "label": "Human-readable name",
      "nodeType": "service-layer | object-area | ...",
      "comboId": "optional-parent-combo-id",
      "data": { "description": "..." }
    }
  ],
  "nodes": [
    {
      "id": "unique-node-id",
      "label": "Human-readable name",
      "nodeType": "value-object | business-object | interface | mapper-interface | event-listener | bpms-process",
      "comboId": "combo-id",
      "data": { "description": "...", ... }
    }
  ],
  "edges": [
    {
      "id": "unique-edge-id",
      "source": "source-node-id",
      "target": "target-node-id",
      "edgeType": "cardinality-relationship | parameter-reference | inclusion-relation | interface-invoke | ...",
      "data": {}
    }
  ]
}
```

## Mapping summary

| Source | G6 element | Notes |
|--------|-------------|--------|
| DDD bounded contexts / layers | combos | scode-layer → service-layer-&lt;shortName&gt;, page-layer-&lt;shortName&gt; |
| Docx layoutAssets (menu, settings) | combos | When docx spec is used for alignment |
| DDD entities, aggregates | nodes (business-object) | Stable id from name slug |
| DDD value-objects | nodes (value-object) | |
| DDD app-services + product-asset | nodes (frontend-interface) | One per page/use-case; id frontend-interface-&lt;slug&gt;; each must have request-object + response-object nodes |
| Docx pageAssets | nodes (pages), nodes (frontend-interface) | pages: id page-&lt;slug&gt;; interfaces from page/use-case list |
| Docx page interaction | nodes (user-action) | **Required**: id user-action-&lt;feature&gt;-&lt;action&gt; per page (e.g. user-action-handover-config-list-init, user-action-receiver-confirm-task); each page at least init/query/search/save-style actions; comboId page-layer-lzxt or page combo |
| DDD repositories (each method) | nodes (mapper-interface) + request-object-mapper-* + response-object-mapper-* | One mapper-interface per repo method; each with matching request/response nodes |
| DDD events/handlers | nodes (event-listener) | eventConfig.eventType as domain event string (e.g. handover.task.confirmed) |
| DDD requirements (processes) | nodes (bpms-process) | |
| Aggregate contains entity | edges (inclusion-relation) | |
| Entity references VO | edges (cardinality-relationship / parameter-reference) | |
| App service invokes repo/domain service | edges (interface-invoke) | |

## References

- **Docx parsing**: [docx](../docx/SKILL.md)
- **G6 schema and conventions**: [g6-parser](../g6-parser/SKILL.md)
- **DDD → G6 mapping and exact data shapes**: `packages/opencode/src/agent/prompt/ddd-to-g6.txt` and **DDD_TO_G6_SCHEMA.md** (this directory)

## Notes

- Primary output is **G6 design.json** (combos, nodes, edges) for consumption by g6-parser and g6.implement. If the user also wants a separate product-assets.json (productAssets.interaction, layoutAssets, pageAssets), run product-asset.extract on the docx first and reference that file when aligning G6.
- Run mammoth from the opencode package directory so `node_modules/mammoth` is available. Use forward slashes in paths; do not use Windows-style paths.
