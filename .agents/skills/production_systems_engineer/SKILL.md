---
name: production_systems_engineer
description: Production Systems & Scale Engineering Skill. Automatically activates when designing databases, building APIs, handling concurrency, optimizing performance, setting up queues, scaling to 10k+ users, and preventing production crashes.
---

# 🚀 PRODUCTION SYSTEMS & SCALE ENGINEERING SKILL
### *From Vibe-Coded Prototype to 10,000+ Concurrent Users*

This skill enforces enterprise-level systems architecture so applications do not crash under high concurrency, heavy traffic, or database load.

---

## 1. ⚡ Database Scale & Query Optimization
* **Kill the N+1 Query Problem**: Never query databases inside `for`/`map` loops. Always use batch lookups (`WHERE id IN (...)`), `JOIN`s, or DataLoader patterns.
* **Smart Indexing**: Add database indexes to every column used in `WHERE`, `ORDER BY`, and foreign key `JOIN` clauses.
* **Connection Pooling**: Always use a connection pooler (e.g. PgBouncer, Prisma Accelerate, Supabase pooler, connection pools in `pg`/`mysql2`) with configured `max` connections to prevent DB socket exhaustion.
* **Pagination**: Enforce cursor-based or limit/offset pagination on all list endpoints (never `SELECT * FROM table` unbounded).

---

## 2. 🔒 Concurrency, Race Conditions & Data Integrity
* **Atomic Transactions**: Wrap multi-step state changes (payments, wallet balances, inventory decrements, seat reservations) in atomic ACID transactions (`BEGIN ... COMMIT`).
* **Row-Level Locking & TOCTOU Defense**: Use pessimistic locking (`SELECT ... FOR UPDATE`) or optimistic concurrency control (version numbers / `updated_at` checks) to prevent double-spending and race conditions.
* **Idempotency Keys**: For sensitive operations (payments, order creations, external webhooks), accept and enforce an `Idempotency-Key` header with Redis/DB caching to prevent double execution on client retries.

---

## 3. 🧵 Background Job Queues & Worker Offloading
* **Never Block the HTTP Loop**: Any task taking >200ms (video transcoding, image resizing, email sending, PDF generation, external AI API calls, data scraping) must be pushed to a background worker/queue (e.g. BullMQ, Redis queue, Celery, SQS, Cloudflare Queues).
* **Dead-Letter Queues (DLQ) & Exponential Backoff**: Configure automatic retries with exponential backoff and DLQs for failed jobs.

---

## 4. 🗄️ Caching & Stampede Protection
* **Multi-Tier Caching**: Cache expensive DB reads and computed responses in Redis or in-memory caches.
* **Thundering Herd / Cache Stampede Defense**: Use mutex locking, early background re-validation (stale-while-revalidate), or probabilistic early expiration when cache keys expire under heavy concurrent load.

---

## 5. 🛡️ Resilience, Circuit Breakers & Graceful Degradation
* **Timeouts on All Outgoing Requests**: Never leave `fetch()` or third-party API calls without an explicit timeout (e.g., `AbortController` with 5–10s timeout).
* **Circuit Breakers**: If a third-party API (payment gateway, AI endpoint) starts failing or timing out, trip a circuit breaker to fail fast and serve cached or fallback data rather than locking server workers.
* **Graceful Shutdown**: On `SIGTERM` / `SIGINT`, stop accepting new requests, finish active DB transactions, close connection pools, and exit cleanly within 10–30 seconds.

---

## 6. 💾 Automated Backups & Disaster Recovery
* **Point-in-Time Recovery (PITR)**: Enable automated daily/hourly snapshots and WAL archiving for production databases.
* **Zero-Downtime Database Migrations**: Apply non-destructive migrations (add nullable column → backfill → add constraint in separate deploys; never drop live columns without multi-phase deprecation).

---

## 7. 📊 Observability, Health Checks & Telemetry
* **Health Endpoints**: Provide `/healthz` (liveness) and `/readyz` (readiness checking DB/Redis connectivity) for load balancers.
* **Structured JSON Logging**: Log with correlation/request IDs (`reqId`) across all service calls to trace errors instantly.
* **Metrics**: Monitor p95 / p99 request latency, error rates, memory usage, and connection pool utilization.
