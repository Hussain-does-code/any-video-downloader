---
name: secure_vibe_coding
description: K37 Master Security Protocol & Audit Engine. Triggered whenever the user says "run K37", "k37", or asks to perform a complete security audit, vulnerability scan, and hardening on any project.
---

# 🛡️ K37 MASTER SECURITY PROTOCOL & AUDIT ENGINE

This skill equips Antigravity with the **K37 Universal Security System**, combining 20+ automated security audits, pre-commit scanners, and vulnerability mitigation protocols.

---

## ⚡ Execution Command: "run K37" / "k37"

When the user asks to **"run K37"** or **"k37"**:
1. Execute the automated K37 runner:
   `node "C:\Users\Hussain\.gemini\config\skills\secure_vibe_coding\scripts\k37_runner.js" .`
2. Audit the codebase against the complete 20-point K37 checklist.
3. Automatically patch any vulnerabilities found.
4. Output a clean, structured K37 Compliance Report.

---

## 📋 The 20-Point K37 Checklist

1. **Hide API Keys**: Server-side `.env` storage only.
2. **Purge Git Secrets**: Pre-commit `.gitignore` + secret scanning.
3. **Use Public DB Key**: Public anon keys only on client; never `service_role`.
4. **Enable Row-Level Security (RLS)**: 100% RLS on all Supabase/PostgreSQL/Firebase tables.
5. **Encrypt Sensitive Data**: AES-256-GCM encryption for stored secrets/PII.
6. **Enforce Server-Side Auth**: Server-verified sessions & JWT tokens.
7. **Lock Record Access (BOLA / IDOR)**: Verify record ownership (`WHERE id = :id AND user_id = :user_id`).
8. **Block Field Tampering (Mass Assignment)**: Strict Zod/Joi schema allowlists.
9. **Secure Session Cookies**: `HttpOnly`, `Secure`, `SameSite=Strict`.
10. **Hash Passwords Securely**: Argon2id or Bcrypt (cost 12+).
11. **Rate Limit Login & Auth**: Brute-force & credential stuffing prevention.
12. **Add Bot Protection**: Cloudflare Turnstile, reCAPTCHA, honeypots.
13. **Parameterize All Queries**: Zero raw SQL string concatenation.
14. **Validate 100% of Input**: Zod/Joi validation on all endpoints.
15. **Escape & Sanitize User Content**: DOMPurify / XSS sanitization.
16. **Restrict File Uploads**: Magic byte validation, extension allowlists, size caps.
17. **Trim API Responses**: Prevent overfetching & PII leakage.
18. **Add Security Headers**: Helmet headers (CSP, HSTS, X-Frame-Options).
19. **Force HTTPS**: TLS 1.3 & HSTS redirection.
20. **Scan Dependencies**: `npm audit` with 0 high/critical CVEs.

---

## 🛠️ Automated Scripts
* **K37 Full Audit**: `node "C:\Users\Hussain\.gemini\config\skills\secure_vibe_coding\scripts\k37_runner.js" <directory>`
* **Secrets Scanner**: `node "C:\Users\Hussain\.gemini\config\skills\secure_vibe_coding\scripts\scan_secrets.js" <directory>`
