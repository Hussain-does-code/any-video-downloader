# 🛡️ K37 MASTER SECURITY PROTOCOL (Universal Security & Audit System)

Whenever the user says **"run K37"**, **"k37"**, **"K37 audit"**, or asks to check/secure a project, execute this complete, non-redundant 20+ point security checklist across all files, APIs, databases, authentication flows, and infrastructure.

Apply these rules universally across ALL current and future projects, models, and agents.

---

## ⚡ K37 Execution Trigger
When triggered with `run K37` or `k37`:
1. **Automated Audit**: Run the K37 automated security audit script (`node "C:\Users\Hussain\.gemini\config\skills\secure_vibe_coding\scripts\k37_runner.js" .`).
2. **Comprehensive Codebase Review**: Check every area in the checklist below against the active project.
3. **Remediation & Patching**: Immediately fix discovered vulnerabilities, harden configurations, and present a structured K37 Compliance Report.

---

## 📋 The Complete Consolidated K37 Checklist

### 1. 🔑 Secrets, API Keys & Git Hygiene
* **Hide API Keys**: All private API keys (OpenAI, Stripe secret key, database passwords, private tokens) MUST remain server-side in `.env`.
* **Purge Git Secrets**: `.gitignore` MUST include `.env`, `.env.*` (except `.env.example`) before the first commit. If any secret was ever committed, immediately rotate it.
* **Public Key Isolation**: Client-side bundles may only contain public anon keys (e.g. `NEXT_PUBLIC_SUPABASE_ANON_KEY`, Mapbox public tokens). Never expose `service_role` or admin credentials to the client.

### 2. 🗄️ Database Access Control & Encryption
* **100% Row-Level Security (RLS)**: Every table in Supabase, PostgreSQL, or Firebase MUST have RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`) with explicit `auth.uid() = user_id` policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
* **Parameterize All Queries**: Always use parameterized queries or ORMs (Prisma, Drizzle, parameterized SQL). Never concatenate raw strings into queries (eliminates SQL Injection).
* **Encrypt Sensitive Data**: Encrypt sensitive user data at rest (PII, tokens, financial details) using AES-256-GCM.

### 3. 🔐 Authentication, Sessions & Credentials
* **Enforce Server-Side Auth**: Never trust client claims. Authenticate every request on the server via verified session tokens or JWT signature verification.
* **Secure Session Cookies**: Store session tokens in `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Never store auth tokens in `localStorage`.
* **Hash Passwords Securely**: Use Argon2id or Bcrypt (cost factor 12+). Never write custom hashing algorithms or store plaintext passwords.
* **Secure Password Resets**: Use single-use, cryptographically random, time-limited (15 min) tokens stored hashed in the database.

### 4. 🚪 Authorization, Field Tampering & Data Exposure
* **Lock Record Access (BOLA / IDOR Defense)**: Always verify ownership on every database operation (`WHERE id = :id AND user_id = :current_user_id`).
* **Block Field Tampering (Mass Assignment Defense)**: Never pass raw `req.body` directly to database inserts/updates. Use strict schema allowlists (Zod/Joi DTOs) to prevent users from updating fields like `is_admin`, `role`, `balance`, or `verified`.
* **Trim API Responses (Prevent Data Overfetching)**: Strip sensitive fields (`password_hash`, internal IDs, internal status flags, PII) before sending JSON responses back to the client.

### 5. 🚦 Rate Limiting, Bot Defense & Financial Protection
* **Rate Limit Login & Auth Endpoints**: Prevent brute-force attacks and credential stuffing by rate limiting login, password reset, and registration endpoints.
* **Rate Limit Paid AI / Metered Endpoints**: Protect against financial DoS (wallet drainage) by placing strict rate limits, user request budgets, and `max_tokens` caps on all routes calling OpenAI, Anthropic, Gemini, Replicate, or Stripe.
* **Add Bot Protection**: Use Cloudflare Turnstile, reCAPTCHA v3, or cryptographic honeypots on public forms and signup endpoints.
* **Prompt Injection Shielding**: Wrap untrusted user inputs in structural XML tags (`<user_input>`) and enforce strict separation between System Prompts and User Content.

### 6. 🛡️ Input Validation, XSS & File Upload Security
* **Validate 100% of Inputs**: Enforce schema validation (Zod, Joi, Valibot) on all query parameters, route params, and request bodies before processing.
* **Escape & Sanitize User Content**: Sanitize rendered HTML with DOMPurify / sanitize-html to prevent Cross-Site Scripting (XSS).
* **Restrict File Uploads**: Enforce strict file extension allowlists, inspect magic bytes (MIME type sniffing defense), enforce max file size limits, and store uploaded files in isolated object storage (S3/Cloudflare R2) with randomized filenames.

### 7. 🌐 Network, Infrastructure & Supply Chain
* **Add Security Headers**: Enforce Helmet headers: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
* **Force HTTPS & HSTS**: Automatically redirect all HTTP traffic to HTTPS and set `Strict-Transport-Security` headers.
* **Scan Dependencies**: Run `npm audit` / security vulnerability scans to ensure zero high-severity CVEs in third-party packages.
