# Web Project QA Checklist — Week 02

## Status legend

- **PASS (automated):** Node integration test executed and passed in the included test runner.
- **RECORD:** Presenter must demonstrate the behavior in a live local browser and capture it on video.

### 1. Authentication functional tests

| Requirement | Status | Evidence |
| --- | --- | --- |
| New account registration succeeds | PASS (automated) / RECORD | Test 03, register through UI |
| Login creates an active session | PASS (automated) / RECORD | Test 05, login through UI |
| Incorrect password returns a generic message | PASS (automated) / RECORD | Test 08, QA lab **Invalid credentials** |
| Logout revokes or invalidates the credential | PASS (automated) / RECORD | Test 07, sign out and try Dashboard |

### 2. Authorization & privilege boundaries

| Requirement | Status | Evidence |
| --- | --- | --- |
| User can access protected User dashboard | PASS (automated) / RECORD | Test 05; 200 in Network |
| User is denied Admin endpoint | PASS (automated) / RECORD | Test 05; 403 in Network |
| Admin can access User and Admin endpoints | PASS (automated) / RECORD | Test 06; 200 in Network |
| Guest is denied authenticated endpoints | PASS (automated) / RECORD | Test 02; 401 in Network |

### 3. Input validation & edge cases

| Requirement | Status | Evidence |
| --- | --- | --- |
| Empty username/password rejected | PASS (automated) / RECORD | Test 09; QA lab **Empty input validation** |
| Special characters or SQL-like syntax do not crash service | PASS (automated) / RECORD | Test 10; QA lab **SQL-like input** |
| User cannot assign `admin` role in registration JSON | PASS (automated) | Test 09 |

### 4. Browser Console & Network health

| Requirement | Status | Evidence |
| --- | --- | --- |
| DevTools Network shows HTTP 200, 401, 403 | RECORD (manual browser requirement) | Network → Fetch/XHR |
| No unhandled JavaScript runtime exceptions in Console | RECORD (manual browser requirement) | Console tab; expected 401/403 HTTP failures are not JS exceptions |

## Run the evidence suite

```bash
npm test
```

Expected from the verified run shipped with this project:

```text
# tests 14
# pass 14
# fail 0
```

The machine-generated JSON and TAP output are in `evidence/`.

## Browser recording checklist (exact actions)

1. Start `npm start` and open `http://localhost:3000`.
2. Open DevTools (`Cmd+Option+I` on Mac, `F12` on Windows). Select Network, choose Fetch/XHR, and enable Preserve log if desired.
3. **Logged out:** open Dashboard: API returns **401**; open Admin console: **401**.
4. **Register** a new `user` using a **demo-only** password. Sign in and open Dashboard: **200**.
5. As that **User**, open Admin console: **403**. Narrate that the API rejected direct access; do not merely point to UI visibility.
6. Sign out. Re-open Dashboard: **401** and explain that the server revoked the session token.
7. Sign in with the Admin account created using `npm run seed:admin` and open Admin console: **200**.
8. Open QA lab. Run **Invalid credentials**: **401**; **Empty input validation**: **400**; **SQL-like input**: **401**. Verify the server remains responsive.
9. Run `npm run inspect:hashes` in a terminal and explain the salt and slow PBKDF2 derivation. Do **not** expose real passwords in the video or inspect sensitive test credentials in detail.
10. Select the Console tab; ensure there are no **uncaught JavaScript exceptions**. Expected failed HTTP requests (401/403) can appear as network resource errors and are not unhandled application exceptions.
11. Record with your **face and screen simultaneously**. Keep the published video strictly between **5:00 and 7:00**.

**Important:** QA is not considered personally verified until the presenter reproduces the browser steps and reviews the evidence. Automated tests cannot replace the required live video.
