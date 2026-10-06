# Security Policy

## Supported versions

My MaNaGeR is a continuously deployed web application. Only the version
currently live at https://mymanagerworkspace.com is supported with security
fixes. There are no maintained back-branches.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do not open a public
GitHub issue for a security problem.

- Email: **garfieldprocis@gmail.com**
- Subject line: `SECURITY - My MaNaGeR`

Include, where you can:

- what the issue is and where it lives (URL, endpoint, or file),
- the steps to reproduce it,
- the impact you believe it has,
- any proof-of-concept you have, and
- how you would like to be credited (or that you prefer to stay anonymous).

## What to expect

- **Acknowledgement** within 5 working days.
- **An initial assessment** (severity and whether we can reproduce it) within
  10 working days.
- **A fix or a status update** as soon as practical after that. We do not
  promise a fixed timeline, but we will tell you where things stand.
- **Credit** in the release notes if you would like it.

## Scope

In scope:

- the Worker and its API routes (`worker.js`, `src/`),
- authentication, session, and account-recovery flows,
- the cloud project sync API and sharing codes,
- the billing and webhook integration,
- the served pages and their Content-Security-Policy.

Out of scope:

- findings that require a compromised device or a malicious browser
  extension,
- missing hardening headers with no demonstrated impact,
- automated scanner output with no proof of exploitability,
- rate-limit or spam reports without a concrete abuse scenario.

## Our commitments

- We do not pursue legal action against researchers who report in good faith
  and give us reasonable time to fix an issue before public disclosure.
- We ask that you do not access, modify, or delete data that is not yours,
  and do not run denial-of-service tests against the live service.
