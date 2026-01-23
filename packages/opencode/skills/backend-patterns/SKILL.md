---
name: backend-patterns
description: API design, database access, caching, and error handling for backends
---

# Backend Patterns

## API design
- Prefer REST or HTTP semantics: GET (idempotent, cacheable), POST (create), PUT/PATCH (update), DELETE
- Use plural nouns for collections: `/users`, `/users/:id`; avoid verbs in URLs
- Version when you must break contracts: `/v1/...` or `Accept` header; keep versions supported during migration
- Return appropriate status codes: 2xx success, 4xx client error, 5xx server error; use 201 for create, 204 for delete

## Database
- Use parameterized queries or an ORM; never concatenate user input into SQL
- Prefer transactions for multi-step writes; keep transactions short
- Use migrations for schema changes; avoid ad-hoc alters in production
- Index columns used in WHERE, JOIN, ORDER; avoid over-indexing writes

## Caching
- Cache at the right layer: in-process for single instance, Redis/Memcached for multi-instance
- Set TTLs; use cache-aside or write-through depending on consistency needs
- Invalidate or version on write; avoid stale reads for critical data

## Error handling
- Log with context (request id, user, operation); avoid logging secrets or full request bodies
- Return stable error shapes to clients: `{ code, message, details? }`; map internal errors to safe messages
- Use structured errors and central handlers; do not leak stack traces or internal types to clients
