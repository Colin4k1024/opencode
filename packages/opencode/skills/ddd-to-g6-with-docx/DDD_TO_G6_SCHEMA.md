# DDD to G6 Schema and Mapping Reference

When generating `design.json`, read this file to match the reference G6 structure (e.g. merged-output-23-01.json): same node types, combo hierarchy, and exact `data` shapes for combos, nodes, and edges.

## Top-level structure

- **combos**: array of module/group definitions (service-layer, object-area, bpms-process-area, hpc-area, page-layer; nested via comboId).
- **nodes**: array of design elements; each has id, label, nodeType, comboId, data.
- **edges**: array of relationships; each has id, source, target, edgeType, label, data.

## Combo data shape

- **data**: `description` (required). Optional: `level` ("data" | "logic"), `purpose`, `boundaries`, `coreEntities`, `businessRules`.
- **Allowed combo nodeTypes only**: scode-layer, service-layer, object-area, bpms-process-area, hpc-area, page-layer, pages. Do not use event-listener or scheduled-task as combo nodeType; use them only as node types.

## Node types and data shapes

| nodeType | data fields (exact) |
|----------|---------------------|
| service-layer, object-area, bpms-process-area, hpc-area, page-layer | description; object-area may have level |
| event-listener | description, level, method, **eventConfig**: { eventType, topic, consumerGroup, messageType, broker }. Use **domain event type string** for eventType (e.g. handover.task.confirmed), not class names. |
| interface | description, level ("logic"), **endpoint**, **requestType** (GET\|POST\|PUT\|DELETE), **requestTypeMethod** (pageList\|detail\|create\|update\|delete\|list), requestTypeMethodName, **method**, **parameters**: { requestRef, responseRef }. **API rule**: Use **GET** for read-only (pageList, list, detail, search, export); POST/PUT/DELETE for create/update/delete. |
| mapper-interface | same as interface; level "data"; endpoint e.g. /mapper/... |
| **pages** | description (required), optional page path/label. Id: `page-<slug>` (e.g. page-handover-config-list). comboId: page-layer-<shortName>. |
| **user-action** | description (required). Id: `user-action-<slug>`. comboId: page combo or page-layer. |
| bpms-process | description, processTypeName, processType, tenantCode, systemCode, status, **url**: { listUrl, addUrl, editUrl, ... }, **associatedBusinessObject** (node id) |
| bpms-start-step, basic-step | description, **mermaid**, **method**, isInvokeInterface. bpms-start-step comboId may be the triggering frontend-interface id or the process-area combo. |
| event-publish | description, isInvokeInterface, **eventDefinition**: { eventType, eventName, topic } |
| scheduled-task | description, cron/trigger |
| status-transition | state machine data as needed |
| **business-object**, **general-object** | description, **tableName**, **tableSchema**, **properties**: [ { field, label, type, length, required, primaryKey, systemField, searchable, description, defaultValue, **dict**: { isDict, value_object_id }, type_name } ]. Enum attributes: dict.isDict true, dict.value_object_id = value-object node id. |
| **value-object** | description; enums: **dict** [ { key, value, code } ]; composite: properties[] same shape as business-object |
| **request-object**, **response-object** | description, **properties** [ { field, label, type, required, description, type_name } ] |

**Mandatory request/response nodes**: Every `requestRef` and `responseRef` on any interface or mapper-interface must have a corresponding node in `nodes` with that id and nodeType `request-object` or `response-object`, with full `data.properties`. No dangling references allowed.

## Edge shape

- **edgeType**: normal-relation, cardinality-relationship, inclusion-relation, condition-flow, parameter-reference, interface-invoke.
- **label**: e.g. "1:N", "N:1", "发起离职审批流程".
- **data**: type (same as edgeType), description; for cardinality add **cardinality** ("one-to-many", "many-to-one", "one-to-one").

## DDD → G6 mapping table

| DDD artifact | G6 element | Key mapping |
|--------------|------------|-------------|
| contexts.md bounded context | combo (service-layer) | One service-layer combo per context; children: object-area, bpms-process-area, hpc-area |
| contexts.md API Endpoints | interface.endpoint, requestType | Match method to GET/POST/PUT/DELETE and path |
| entities.md (aggregate root) | business-object | tableName, tableSchema, data.properties[] from attribute table |
| entities.md (contained entity) | general-object | same data shape as business-object |
| value-objects.md enum | value-object | data.dict [ { key, value, code } ] |
| value-objects.md composite | value-object | data.properties[] when needed |
| app-services.md + product-asset | frontend-interface | When product-asset present: one interface per page/use-case (id frontend-interface-&lt;slug&gt;), mapped to app-service methods; endpoint, requestType (GET for read), parameters.requestRef/responseRef with matching request/response nodes |
| repositories.md **each method** | mapper-interface + request-object-mapper-* + response-object-mapper-* | **Each** repository method → one mapper-interface; method suffix in **kebab-case** (e.g. select-by-id, select-by-config-id, select-page). Ids: mapper-interface-handover-config-select-by-id, mapper-interface-handover-config-select-page. Also include mapper-interface-employee-search, mapper-interface-config-match, mapper-interface-task-by-employee, mapper-interface-task-by-receiver, mapper-interface-task-statistics when DDD has those capabilities; each with request/response nodes. |
| events.md consumer/handler | event-listener | eventConfig (eventType as domain string e.g. handover.task.confirmed, topic, consumerGroup, messageType, broker) |
| events.md handler steps | basic-step | description, mermaid, method, isInvokeInterface; comboId = event-listener id |
| events.md published event | event-publish | eventDefinition (eventType, eventName, topic) |
| requirements.md process | bpms-process | processTypeName, processType, url, associatedBusinessObject |
| requirements.md trigger | bpms-start-step | mermaid, method, isInvokeInterface; comboId = triggering frontend-interface or process-area combo |
| boundaries.md / DTOs | request-object, response-object | data.properties[]; ids request-object-&lt;slug&gt;, response-object-&lt;slug&gt; |
| aggregates.md root contains entity | edge inclusion-relation | source=root, target=entity |
| Entity–entity reference | edge cardinality-relationship | label "1:N"|"N:1"|"1:1", data.cardinality |
| Entity → value-object (enum) | edge cardinality-relationship | label "N:1" |
| Process → step / step → step | edge normal-relation or condition-flow | label from flow |
| **product-asset pageAssets** | **pages** (nodeType pages), **frontend-interface** (id frontend-interface-&lt;slug&gt;) | One pages node per page; one interface per page/use-case action (list, search, detail, toggle, save, export, my-task-*, receiver-*, etc.) |
| **product-asset page interaction** | **user-action** (nodeType user-action) | When docx/product-assets describe page-level actions; id user-action-&lt;slug&gt;, comboId page or page-layer |
| **repositories.md each method** | mapper-interface + request-object-mapper-* + response-object-mapper-* | One mapper-interface per repo method; each with matching request/response nodes |

## Property object (business-object, general-object, request-object, response-object)

Each item in **data.properties** array:

- **field** (camelCase), **label**, **type** (String|Integer|Date|Boolean), **length** (string or empty), **required** (boolean), **primaryKey** (boolean), **systemField** (boolean), **searchable** (boolean), **description**, **defaultValue**, **type_name** (字符串|数字|日期).
- For enum fields add **dict**: { "isDict": true, "value_object_id": "value-object-&lt;enum-slug&gt;" }; otherwise dict: { "isDict": false }.

## Id conventions

- **Combos**: Root `scode-layer`. With service short name: `service-layer-&lt;shortName&gt;`, `object-area-&lt;shortName&gt;`, `page-layer-&lt;shortName&gt;`. Otherwise: service-layer-&lt;context-slug&gt;, object-area-&lt;slug&gt;, bpms-process-area.
- **Nodes**: business-entity-&lt;name&gt;, general-object-&lt;name&gt;, value-object-&lt;name&gt;; **request-object-&lt;operation-slug&gt;**, **response-object-&lt;operation-slug&gt;** (for interfaces); **request-object-mapper-&lt;entity&gt;-&lt;method&gt;**, **response-object-mapper-&lt;entity&gt;-&lt;method&gt;** (for mapper-interface). **When product-asset is provided, interface id must be frontend-interface-&lt;slug&gt;; do not use interface-&lt;slug&gt;.** Examples: frontend-interface-handover-config-list, frontend-interface-handover-config-search; **mapper-interface** id with method suffix in **kebab-case** (e.g. mapper-interface-handover-config-select-by-id, mapper-interface-handover-config-select-page) and domain mappers: mapper-interface-employee-search, mapper-interface-config-match, mapper-interface-task-by-employee, mapper-interface-task-by-receiver, mapper-interface-task-statistics; **page-&lt;slug&gt;** (e.g. page-handover-config-list, page-all-handover-tasks, page-my-handover-tasks-emp); **user-action-&lt;slug&gt;**.
- **Edges**: e.g. cardinality-&lt;source-slug&gt;-to-&lt;target-slug&gt;, bpms-relation-&lt;label-slug&gt;.

Use stable, deterministic ids (slugs from names) so g6-parser and g6.implement can rely on them.
