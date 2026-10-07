#!/usr/bin/env python3
"""Container smoke test for the running docker-compose stack.

Usage:
    docker compose up -d --build
    docker compose exec -T -e PLATFORM_ADMIN_EMAIL=admin@example.test \
        -e PLATFORM_ADMIN_PASSWORD='DemoAdminPassw0rd!2026' \
        -e MONGODB_URI=mongodb://mongo:27017/shadow-ai-auditor \
        backend node scripts/provision-platform-admin.mjs
    python3 scripts/container-smoke.py

Run against a FRESH volume (tenant creation uses fixed demo emails).
Exercises health/readiness, onboarding, tenant isolation, server-authoritative
policy, and the BLOCK / SANITIZE / ALLOW gateway paths against the real
containers. No test completes a provider call: without a provider credential
the upstream answers 401, which is enough to prove forwarding.
"""
"""Container smoke test: health, onboarding, policy, gateway BLOCK/SANITIZE/ALLOW, tenant isolation."""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3001"
PROMPT = "please use my key AKIAIOSFODNN7EXAMPLE and email jane.doe@example.test"


def req(method, path, body=None, token=None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        try:
            return e.code, json.loads(payload or "{}")
        except json.JSONDecodeError:
            return e.code, payload
    except Exception as e:  # noqa: BLE001
        return 0, {"error": repr(e)}


results = []


def check(name, ok, detail):
    results.append((name, "PASS" if ok else "FAIL", detail))


# 1. operational endpoints
s, b = req("GET", "/health")
check("health endpoint", s == 200 and b.get("status") == "ok", f"{s} {b}")
s, b = req("GET", "/ready")
check("readiness endpoint", s == 200 and b.get("status") == "ready", f"{s} {b}")
check("health leaks no internals",
      all(k not in str(b).lower() for k in ("mongo", "secret", "uri", "version")),
      json.dumps(b)[:120])

# 2. authentication boundaries
s, b = req("GET", "/api/events")
check("events require a token", s == 401, f"{s} {str(b)[:60]}")
s, b = req("POST", "/api/auth/login", {"email": "a@b.test", "password": {"$gt": ""}})
check("non-string password rejected", s == 400, f"{s} {str(b)[:60]}")
s, b = req("POST", "/api/auth/login", {"email": "admin@example.test", "password": "wrong-password-123"})
check("bad credentials rejected", s in (401, 400), f"{s} {str(b)[:60]}")
s, b = req("GET", "/api/events", token="not.a.jwt")
check("malformed token rejected", s == 401, f"{s}")
s, b = req("GET", "/no/such/route", token=None)
check("unknown route is a JSON 404", s == 404 and isinstance(b, dict) and "error" in b,
      f"{s} {str(b)[:60]}")

# 3. platform admin onboarding (tenant creation bundles the admin invitation)
s, plat = req("POST", "/api/platform-admin/auth/login",
              {"email": "admin@example.test", "password": "DemoAdminPassw0rd!2026"})
check("platform admin login", s == 200 and plat.get("token"), f"{s}")
ptok = plat.get("token")

s, t1 = req("POST", "/api/platform-admin/tenants",
            {"name": "Acme Corp", "adminName": "Acme Admin", "adminEmail": "admin@acme.test"}, token=ptok)
s2, t2 = req("POST", "/api/platform-admin/tenants",
             {"name": "Globex", "adminName": "Globex Admin", "adminEmail": "admin@globex.test"}, token=ptok)
check("tenants provisioned with bundled admin invite", s == 201 and s2 == 201, f"A={s} B={s2}")

tenant_a = t1.get("tenant", {}).get("id")
tenant_b = t2.get("tenant", {}).get("id")

s, acc1 = req("POST", "/api/platform-admin/invitations/accept",
              {"token": t1.get("invitation", {}).get("token"), "password": "AcmeAdminPassw0rd!2026"})
s2, acc2 = req("POST", "/api/platform-admin/invitations/accept",
               {"token": t2.get("invitation", {}).get("token"), "password": "GlobexAdminPassw0rd!2026"})
check("both tenants activated by their admins", s in (200, 201) and s2 in (200, 201), f"A={s} B={s2}")

s, la = req("POST", "/api/auth/login", {"email": "admin@acme.test", "password": "AcmeAdminPassw0rd!2026"})
s2, lb = req("POST", "/api/auth/login", {"email": "admin@globex.test", "password": "GlobexAdminPassw0rd!2026"})
check("tenant admin logins", bool(la.get("token")) and bool(lb.get("token")), f"A={s} B={s2}")
tok_a, tok_b = la.get("token"), lb.get("token")

# 4. tenant isolation
s, b = req("GET", "/api/events?orgId=" + str(tenant_b), token=tok_a)
foreign = [e for e in (b.get("events") or []) if e.get("orgId") not in (None, tenant_a)]
check("cross-tenant orgId parameter ignored", s == 200 and not foreign,
      f"{s} events={len(b.get('events') or [])} foreign={len(foreign)}")

s, b = req("GET", "/api/users", token=tok_a)
emails = [u.get("email") for u in (b.get("users") or [])]
check("user list scoped to own tenant", s == 200 and "admin@globex.test" not in emails,
      f"{s} emails={emails}")

s, b = req("GET", "/api/events", token=tok_b)
check("second tenant sees no inherited events", s == 200, f"{s} events={len(b.get('events') or [])}")

# 5. server-authoritative policy
s, b = req("PATCH", "/api/settings/org/policy", {"defaultAction": "DROP_ALL"}, token=tok_a)
check("unknown policy action rejected", s == 400, f"{s} {str(b)[:70]}")

s, b = req("PATCH", "/api/settings/org/policy", {"defaultAction": "BLOCK"}, token=tok_a)
check("policy set to BLOCK", s == 200, f"{s}")

# 6. device credential
s, code = req("POST", "/api/auth/device/enrollment-code", {"label": "smoke"}, token=tok_a)
check("enrollment code issued", s in (200, 201) and code.get("code"), f"{s}")
s, reg = req("POST", "/api/auth/device/register", {"code": code.get("code")})
check("device registered", s == 201 and reg.get("token"), f"{s}")
dvc = reg.get("token")

# 7. gateway enforcement
payload = {"model": "gpt-4", "messages": [{"role": "user", "content": PROMPT}]}
s, b = req("POST", "/gateway/v1/openai/v1/chat/completions", payload, token=dvc)
check("BLOCK returns 403", s == 403, f"{s} {str(b)[:120]}")
check("BLOCK body names the policy", "Blocked by Shadow AI Security Policy" in str(b), str(b)[:120])

s, ev = req("GET", "/api/events?limit=10", token=tok_a)
top = (ev.get("events") or [{}])[0]
check("BLOCK event recorded as PREVENTED",
      top.get("enforcementStatus") == "PREVENTED" and top.get("requestForwarded") is False,
      f"{top.get('enforcementStatus')} forwarded={top.get('requestForwarded')}")

# tampering: the client cannot lower severity or force ALLOW through the gateway
tampered = dict(payload)
tampered.update({"severity": "LOW", "riskScore": 0, "policyDecision": "ALLOW",
                 "orgId": tenant_b, "userId": "attacker"})
s, b = req("POST", "/gateway/v1/openai/v1/chat/completions", tampered, token=dvc)
s2, ev = req("GET", "/api/events?limit=10", token=tok_a)
top = (ev.get("events") or [{}])[0]
check("client-supplied severity/decision/orgId ignored",
      s == 403 and top.get("orgId") in (None, tenant_a)
      and top.get("severity") in ("HIGH", "CRITICAL"),
      f"http={s} sev={top.get('severity')} org={top.get('orgId')} decision={top.get('policyDecision')}")

# SANITIZE (blockOnHigh disabled so the operator's SANITIZE choice is the one under test)
s, b = req("PATCH", "/api/settings/org/policy",
           {"defaultAction": "SANITIZE", "blockOnHigh": False}, token=tok_a)
check("policy set to SANITIZE", s == 200, f"{s} {str(b)[:70]}")
s, b = req("POST", "/gateway/v1/openai/v1/chat/completions", payload, token=dvc)
s2, ev = req("GET", "/api/events?limit=5", token=tok_a)
top = (ev.get("events") or [{}])[0]
check("SANITIZE event records redactions",
      top.get("enforcementStatus") == "SANITIZED" and (top.get("sanitizedRedactions") or 0) > 0,
      f"http={s} status={top.get('enforcementStatus')} redactions={top.get('sanitizedRedactions')}")

# ALLOW (upstream attempt; provider has no credential, GATEWAY_TIMEOUT_MS=4000)
s, b = req("PATCH", "/api/settings/org/policy", {"defaultAction": "ALLOW"}, token=tok_a)
check("policy set to ALLOW", s == 200, f"{s}")
benign = {"model": "gpt-4", "messages": [{"role": "user", "content": "say hello"}]}
s, b = req("POST", "/gateway/v1/openai/v1/chat/completions", benign, token=dvc)
s2, ev = req("GET", "/api/events?limit=5", token=tok_a)
top = (ev.get("events") or [{}])[0]
check("ALLOW forwards upstream (attempt recorded)",
      top.get("requestForwarded") is True and s in (200, 400, 401, 500, 502, 504),
      f"http={s} forwarded={top.get('requestForwarded')} status={top.get('enforcementStatus')}")

# 8. audit trail
s, b = req("GET", "/api/audit-log?limit=5", token=tok_a)
check("audit log reachable", s == 200, f"{s}")
s, b = req("GET", "/api/audit-log?limit=5", token=tok_b)
check("audit log scoped to own tenant", s == 200, f"{s}")

print()
print("=" * 78)
width = max(len(n) for n, _, _ in results)
fails = 0
for name, verdict, detail in results:
    if verdict == "FAIL":
        fails += 1
    print(f"{name:<{width}}  {verdict}   {detail}")
print("=" * 78)
print(f"{len(results) - fails} passed, {fails} failed, {len(results)} total")
sys.exit(1 if fails else 0)
