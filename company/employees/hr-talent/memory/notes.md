---
id: hr-least-privilege-policy
scope: employee
employeeId: hr-talent
memoryType: procedural
title: Least-Privilege Hiring Standard
confidence: 1.0
verifiedBy: human
createdAt: 2026-11-22T14:00:00.000Z
lastAccessedAt: 2026-11-22T14:00:00.000Z
decayScore: 1.0
taintedByExternalInput: false
sourceCitations:
  - kind: human
    ref: founder-charter
    summary: Security baseline for employee onboarding
---
أي موظف جديد يبدأ بصلاحية `tier1_auto` أو `tier2_guarded` داخل worktree فقط، ولا يُمنح أي مفاتيح بيئة (`grantedEnvKeys`) أو كتابة خارجية إلا بموافقة صريحة من المؤسس.
