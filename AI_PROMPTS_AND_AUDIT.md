# AI Disclosure, Original Prompt & Security Audit

**AI tool:** OpenAI ChatGPT.  
**Use:** Initial system design, application code scaffold, test design, documentation, and security review.  
**Source:** Assignment text provided by the student. This report describes the actual AI-assisted build; it does not imply the student independently hand-coded the resulting security fixes.

## 1. Original initial prompt, supplied in the assignment

The following is the exact sample prompt included with the assignment and used as the initial design brief, including its substantive requirements:

> Act as a senior security engineer. Build a lightweight full-stack application (or REST API with a simple frontend) demonstrating basic Authentication and Role-Based Access Control (RBAC).
>
> The application must include:
>
> 1. User Registration & Login with two roles: 'User' and 'Admin'.
> 2. Password hashing using a modern, secure algorithm.
> 3. Token-based (JWT) or Session-based authentication.
> 4. Three distinct views or API endpoints:
>    - Public: Accessible to anyone (e.g., home/landing page).
>    - Protected (User): Accessible to any authenticated user (e.g., user profile or dashboard).
>    - Restricted (Admin Only): Accessible ONLY to users with the 'Admin' role (e.g., user management list or system metrics).
>
> Provide the backend server code, route-guard middleware, and a minimal frontend or HTML/JS interface to test registration, login, logout, and role access.

The full assignment also required an explicit security audit, a QA checklist, a 5–7 minute live recording, a GitHub README, and the LMS submission template.

## 2. AI-generated first-pass security pattern: REJECTED

**Security issue identified:** relying on a client-side role check as the only protection for an Admin resource. This is an intentionally preserved *first-pass candidate pattern* produced during this AI-assisted exercise for critical review; it is **not part of the running application**.

```javascript
// REJECTED FIRST PASS — NOT SECURE
if (currentUser.role === 'admin') {
  showAdminButton();
}
// There is no equivalent permission check on GET /api/admin/users.
```

**Why this is a defect:** the UI is an untrusted client. An authenticated normal User can bypass the hidden button by directly sending `GET /api/admin/users` in DevTools, curl, or another HTTP client. Hiding a button is a user-experience decision, not authorization.

**Correction in the delivered code (`src/app.js`):**

```javascript
function requireAdmin(res, auth) {
  if (!requireAuth(res, auth)) return false;
  if (auth.user.role !== 'admin') {
    respond(res, 403, { error: 'Forbidden: admin role required' });
    return false;
  }
  return true;
}
```

The server calls `requireAdmin()` before reading and returning its Admin-only account data. The test `05 Login creates an HttpOnly session; dashboard allows User; admin denies User (403)` proves the correction.

## 3. Other security review decisions

| Concern | Unsafe possibility to reject | Implemented control | Evidence |
| --- | --- | --- | --- |
| Password storage | Plaintext, SHA-256 alone, or MD5 | PBKDF2-HMAC-SHA-256, 600,000 iterations, unique 128-bit salt | `src/auth.js`; tests 03 and 04 |
| Client role escalation | Accept `role: "admin"` during registration | Explicitly reject user-supplied role and always assign `user` | `src/app.js`; test 09 |
| Frontend-only authorization | Hide the Admin tab without API protection | Check role in the backend on each admin call | `src/app.js`; tests 02, 05, 06 |
| Session reuse | Trust arbitrary browser-supplied IDs | New random token after login; hashed token in server storage | `src/auth.js`; test 05 |
| Logout bypass | Remove the browser cookie but keep server token valid | Delete the persisted session hash | `src/store.js`; test 07 |
| Credential enumeration | Different errors for unknown vs incorrect passwords | Generic login error with dummy hashing path | `src/auth.js`; test 08 |
| Secret exposure | Commit `.env` or return password hashes in JSON | `.gitignore`, sanitized API user objects | `.gitignore`; tests 03, 06 |
| Login brute force | Unlimited guesses | Simple in-memory per-IP failure limiter (demo only) | `src/app.js`; test 13 |
| Browser-origin abuse | Accept arbitrary cross-origin JSON requests | Same-site cookies, JSON-only POST, Origin checks | `src/app.js`; test 11 |

## 4. What the AI produced correctly

- Clear separation of AuthN (verify identity) and AuthZ (verify role at a resource).
- Minimal application with testable HTTP endpoints and a readable security-oriented interface.
- Observable 200, 401, and 403 response paths in the API and DevTools Network.
- Reproducible integration suite with 14 passing cases and machine-generated QA evidence.
- Self-authored architecture diagram and practical documentation.

## 5. Scope and remaining work

The generated demo is intentionally constrained to single-machine execution. It does not offer MFA, real identity verification, production database guarantees, distributed rate limiting, or secure managed deployment. The student must run the project locally, inspect the DevTools results, record face + screen for 5–7 minutes, and provide the actual GitHub/YouTube links.

**Relevant OWASP guidance:** [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), and [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
