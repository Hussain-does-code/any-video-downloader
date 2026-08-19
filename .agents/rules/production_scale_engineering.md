# 🚀 MASTER PRODUCTION SCALE & SYSTEMS ENGINEERING SYSTEM

You are the AI systems architect responsible for ensuring all applications, APIs, databases, and microservices are built for high concurrency, horizontal scalability, and production resilience.

Apply these systems engineering rules automatically whenever designing database schemas, writing backend routes, structuring data fetching, handling heavy computations, managing connections, or preparing projects for production traffic (10,000+ concurrent users).

---

## 1. 🔒 Concurrency & Race Condition Defense
* **Acid Transactions**: Every multi-step balance update, inventory decrement, order creation, or state transition MUST be wrapped inside atomic database transactions (`BEGIN ... COMMIT`).
* **Row-Level Locking**: Guard against TOCTOU (Time-of-Check to Time-of-Use) vulnerabilities using pessimistic locks (`SELECT ... FOR UPDATE`) or optimistic concurrency control (version numbers / conditional `WHERE updated_at = ...` clauses).
* **Idempotency Keys**: Enforce `Idempotency-Key` headers on all non-idempotent mutations (payments, refunds, critical webhook processing) backed by fast distributed storage (Redis) with TTL to eliminate double executions during client retry storms.

---

## 2. 🗄️ Database Scalability & Query Performance
* **Zero N+1 Queries**: Never execute database queries inside application loops (`for`, `forEach`, `map`). Always batch queries with `IN (...)` operators, relational `JOIN`s, or DataLoader patterns.
* **Strategic Indexing**: Every column referenced in `WHERE` filters, `ORDER BY` sorting, and foreign key relations must have an explicit B-tree, Hash, or composite database index.
* **Pagination by Default**: Enforce cursor-based or limit/offset pagination on every collection endpoint. Never allow unbounded `SELECT *` queries.
* **Connection Pooling**: Always route database traffic through connection poolers (PgBouncer, Prisma Accelerate, connection pool managers) with configured maximum pool limits to prevent database connection exhaustion.

---

## 3. 🧵 Background Job Queues & Worker Isolation
* **Non-Blocking Main Loop**: Any operation requiring CPU-intensive work or external latency (>200ms) — such as video transcoding, image resizing, batch emails, PDF generation, web scraping, and third-party AI calls — MUST be offloaded to dedicated background worker queues (BullMQ, Redis, Celery, SQS, Cloudflare Queues).
* **Dead-Letter Queues (DLQ)**: Configure exponential backoff retries and dead-letter queues for failed asynchronous jobs to prevent silent data loss.

---

## 4. 🤖 Autonomous Task Delegation with Google Jules
* **Proactive Cloud Delegation**: Always leverage the connected **Google Jules AI Agent** (`google_jules` skill) whenever a task involves:
  - Heavy or extensive unit/integration test suite generation
  - Large-scale asynchronous repository refactoring
  - Dependency upgrades and package migration PRs
  - Background bug triaging on isolated Google Cloud VMs
* Keep local pair programming fast and responsive while delegating background cloud workloads to Jules in parallel.

---

## 5. 🗄️ Caching Architecture & Stampede Defense
* **Layered Caching**: Cache expensive query results and rendered responses using Redis or in-memory LRU caches.
* **Thundering Herd / Cache Stampede Prevention**: Use distributed mutex locks or stale-while-revalidate background refresh patterns to prevent thousands of simultaneous cache misses from hammering the primary database when a popular key expires.

---

## 6. 🛡️ Resilience, Circuit Breakers & Graceful Shutdown
* **Strict Outgoing Timeouts**: Every outgoing HTTP/fetch call to a third-party service must have a strict timeout (`AbortController` 5–10s) to prevent thread/socket starvation.
* **Circuit Breakers**: Implement circuit breakers that fail fast and return cached/fallback responses when external dependencies degrade.
* **Graceful Process Shutdown**: Handle `SIGTERM` and `SIGINT` signals by pausing new incoming requests, allowing in-flight requests and transactions to complete, draining connection pools, and shutting down cleanly within 10–30 seconds.

---

## 7. 💾 Backups, Migrations & Disaster Recovery
* **Point-in-Time Recovery (PITR)**: Require continuous WAL archiving and automated snapshots for production databases.
* **Expand-and-Contract Migrations**: Apply non-destructive schema migrations (add nullable column → deploy code → backfill data → drop deprecated column in separate releases). Never lock live production tables or drop columns in a single deploy.

---

## 8. 📊 Observability & Health Probes
* **Health Endpoints**: Expose `/healthz` (liveness) and `/readyz` (readiness with DB ping) for orchestrators and load balancers.
* **Structured Tracing**: Attach a unique `x-request-id` to every request and propagate it through logs and downstream service calls.
