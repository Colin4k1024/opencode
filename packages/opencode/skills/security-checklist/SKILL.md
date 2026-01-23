---
name: security-checklist
description: Security review checklist for injection, auth, sensitive data, dependencies, and logging
---

# Security Checklist

## Injection
- [ ] All user input passed to SQL uses parameterized queries or a safe ORM
- [ ] Command execution (shell, exec) does not concatenate user input; use argv arrays and strict allowlists
- [ ] HTML/JS output is escaped or rendered via a templating engine; no `innerHTML`/`eval` with user data
- [ ] Headers, redirects, and file paths are validated; no CRLF or path traversal

## Authentication and authorization
- [ ] Auth is required for protected routes; no missing or overly permissive checks
- [ ] Session/Token is verified on each request; signature, expiry, and revocation are enforced
- [ ] Authorization uses a consistent model (RBAC, ABAC, or resource-level); no privilege escalation paths

## Sensitive data
- [ ] Secrets (API keys, passwords) are not hardcoded; use env, secret manager, or vault
- [ ] PII and secrets are not logged; log only ids, types, and non-sensitive metadata
- [ ] TLS in transit; sensitive fields encrypted at rest where required

## Dependencies
- [ ] Dependencies are pinned and periodically updated; run `audit` or equivalent
- [ ] Supply chain: prefer official images and verified packages; review `package-lock`/manifest changes

## Logging and monitoring
- [ ] Logs do not contain passwords, tokens, or full request/response bodies
- [ ] Failed auth and suspicious patterns are monitored; alerts for anomalies where appropriate
