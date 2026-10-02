<<<<<<< HEAD
# SCET Lab Component & Issue Tracking System — Web Edition

Node.js/Express API + vanilla-JS single-page frontend, Firebase (Cloud Firestore + Authentication).
Replaces the Oracle/CustomTkinter desktop app and the separate student Flask API.

## 1. Firebase setup
1. Create a Firebase project. Enable **Authentication → Email/Password** and create a **Cloud Firestore** database.
2. Project settings → **Service accounts** → *Generate new private key* → save as `serviceAccountKey.json` in this folder (git-ignored).
3. Project settings → General → copy the **Web API key** into `FIREBASE_WEB_API_KEY`.
4. Publish `firestore.rules` (denies all direct client access; only this server, via the Admin SDK, touches data).

## 2. Configure & run
```bash
cp .env.example .env      # fill in every value; SESSION_SECRET: openssl rand -hex 32
npm install
npm test                  # unit tests for IP guard, due dates/fines, hashing, tokens
npm start                 # http://<server>:3000
```

## 3. Network restriction (read this)
Every `/api/*` route except `/api/health` passes through `middleware/ipGuard.js`, which returns
**403 `IP_NOT_ALLOWED`** unless the client address is in `ALLOWED_IPS` (default `10.175.212.212`; IPs and CIDRs, comma-separated).
- The client address is `req.ip` only. `X-Forwarded-For` is honoured **only** for the number of proxy hops in `TRUST_PROXY`.
- `10.175.212.212` is a *private* (RFC 1918) address. The server must therefore run on the same LAN, or behind a reverse
  proxy on that LAN, so it actually sees that address. On Firebase Hosting / Cloud Run / any public host the server sees
  public addresses instead, and every request would be blocked. If you meant your campus's public egress IP, put that in `ALLOWED_IPS`.
- One address means one machine (or one NAT gateway). Use a CIDR such as `10.175.212.0/24` to admit a lab.

## 4. Accounts
- **First admin:** *Login page → First-time admin setup*. Needs `MASTER_ADMIN_USERNAME/PASSWORD` from `.env`. The slot is claimed
  atomically (`meta/bootstrap`), so the master credentials stop working after the first admin exists.
- **More admins:** created by a signed-in admin (*Admins* tab); each has their own ID/password and can be deactivated.
- **Students:** self sign-up; the enrollment number is the login ID. Students get the read-only catalogue and their own issues/fines/gate passes.
- Sessions are 8-hour, httpOnly, SameSite=Strict Firebase session cookies; login is rate-limited (5/min per IP+username).

## 4b. Department isolation
Admins must enter a branch's password (scrypt-hashed) to unlock it; the unlock is a signed httpOnly cookie bound to that admin and branch.
Forgot-password and branch deletion require an emailed 6-digit OTP (10-minute expiry, 5 attempts, stored as HMAC).

## 5. Audit trail
`middleware/audit.js` writes `auditLogs` after every successful admin action (login/logout, branch, inventory, issue/return, reports,
admin management) with the admin's **username**, timestamp, action, branch, details and IP. There is no update/delete endpoint.

## 6. Data model (Firestore)
`users`, `meta/bootstrap`, `branches/{CODE}` (issueSeq, passwordHash), `components/{CODE__COMPID}`, `componentImages`,
`issues/{CODE__seq}`, `auditLogs`, `otps`. No composite indexes are needed (queries use equality filters and sort in the server).

## 7. Layout
```
backend/  server.js config.js firebase.js  middleware/(ipGuard auth audit rateLimit)  routes/(auth catalog branches inventory issues reports student audit)  utils/
frontend/ index.html css/styles.css js/(main api ui state) js/views/(auth student branches console inventory ledger tools audit shell) assets/
```
=======
# Scet-App
>>>>>>> a04e654f6ce34c313662220dfca062bf5123a3cf
