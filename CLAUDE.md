## Skills (check these first)
This repo ships skills in `.claude/skills/` (brainstorming executing-plans hallmark ponytail ponytail-audit ponytail-review security-audit systematic-debugging verification-before-completion writing-plans ). Before starting a task, check which apply, read that SKILL.md, and follow it.
- **ponytail** — every coding task: smallest change that fully works; reuse what's already here. `ponytail-review` / `ponytail-audit` to trim bloat.
- **brainstorming → writing-plans → executing-plans** — new features or anything bigger than a quick fix.
- **systematic-debugging** — any bug: find the root cause before changing code.
- **verification-before-completion** — test it before calling it done.
- **hallmark** — any new page, section or redesign (`hallmark audit` scores without editing). Prefer it over frontend-design.
- **security-audit** — before handing the app to anyone, before launches, and after adding logins, firestore.rules, Apps Script endpoints or anything storing people's data. This repo only.

## Rules for this repo
- **It's public**, and GitHub Pages serves every file. Never commit screenshots, exports or anything with owner numbers, tenant details or deal prices (`.gitignore` blocks root images). Private data lives only in the P&L and deals sheets, read through `owner-dashboard/Code.gs`.
- **Changed `Code.gs`?** Bump `CODE_VERSION` in `Code.gs` and `SERVER_VERSION` in `dashboard/dashboard.js` to the same value. The Growth tab's Connections check shows a red "Server code" line until the live Apps Script matches.
- **Finance math** (returns, pay-down order, reserves) lives in `dashboard/finance.js`; run `node tests/finance.test.js` after changing it.
- **Never send real texts while testing.** Tenant texting stays off until the A2P registration is approved and Sam and Jack both see a test text.
