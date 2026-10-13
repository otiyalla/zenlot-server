---
# Symphony workflow for zenlot-server (https://github.com/openai/symphony — SPEC.md).
# Symphony's runner speaks the Codex app-server protocol, so this file drives Codex runs.
# Claude Code and interactive sessions use AGENTS.md / CLAUDE.md directly and ignore this.
#
# BEFORE FIRST USE: set tracker.provider.project_slug, export LINEAR_API_KEY, and confirm the
# Linear adapter's key names against your Symphony build (the spec leaves `tracker.provider`
# to each adapter). Agents only pick up issues labelled `agent` and stop at "In Review".
tracker:
  kind: linear
  provider:
    project_slug: REPLACE_WITH_LINEAR_PROJECT_SLUG
  required_labels:
    - agent
  active_states:
    - Todo
    - In Progress
    - Rework
  terminal_states:
    - Done
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
polling:
  interval_ms: 30000
workspace:
  root: ~/symphony_workspaces/zenlot-server
hooks:
  after_create: |
    git clone --origin origin "${ZENLOT_SERVER_REPO_URL:-https://github.com/otiyalla/zenlot-server.git}" .
    git checkout dev
    corepack enable
    yarn install --immutable
    DATABASE_URL=postgresql://ci:ci@localhost:5432/ci yarn db:generate
  before_run: |
    git fetch origin dev --quiet
  timeout_ms: 600000
agent:
  max_concurrent_agents: 2
  max_turns: 20
codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    networkAccess: true
---

You are working on Linear issue {{ issue.identifier }} in the **zenlot-server** repository
(NestJS API for the Zenlot trading journal). This is an unattended session: do not ask a human
for follow-up actions.

{% if attempt %}
This is a retry or continuation (attempt {{ attempt }}). Resume from the current workspace
state; do not redo finished work or start over.
{% endif %}

Issue: {{ issue.identifier }} — {{ issue.title }}
Current status: {{ issue.state }}
URL: {{ issue.url }}

Description:
{% if issue.description %}{{ issue.description }}{% else %}No description was provided. Treat the
title as the whole request, and if that is ambiguous, stop and report the question.{% endif %}

## How to work

1. **Read `AGENTS.md` first.** It defines the architecture, the auth / tenant-isolation /
   validation / migration invariants, the domain rules, and the commands. Follow it exactly.
2. Work on a branch created from `dev`{% if issue.branch_name %} named `{{ issue.branch_name }}`{% endif %}.
   Never commit to or push `dev` or `main`.
3. Keep the change small and focused on this issue. Note unrelated problems in the PR
   description instead of fixing them.
4. Add or update tests for the behavior you change. New endpoints that touch user data need an
   authorization test (see `src/trade/trade.controller.authz.spec.ts`).
5. Before opening the PR run, and make pass: `yarn lint:ci`, `yarn typecheck`, `yarn test`,
   and `yarn build`. Fix failures you caused. Do not skip, delete, or loosen a test or lint
   rule to get green, and do not raise the `--max-warnings` ratchet.
6. Open a pull request **against `dev`** using `.github/pull_request_template.md`. Put
   `{{ issue.identifier }}` in the title or body and fill in every required section,
   including a Validation section that lists the checks you actually ran and their results.
7. If you have Linear tooling available, move the issue to **In Review** and post the PR link
   on it. Otherwise say so in your final message.

## Guardrails

- **Do not merge** the PR or approve it. A human reviews and merges.
- Never run `db:migrate:prod`, `db:migrate:dev`, `db:reset`, `db:docker:rebuild`, or touch any
  production or shared database. Schema changes need a new Prisma migration file only.
- Never read or print secrets or `.env*` contents, and never commit credentials.
- Do not edit `.github/workflows/**`, `Dockerfile`, or `docker/**` unless the issue asks.
- Stop early only for a true external blocker (missing access, secret, or an ambiguous
  requirement). Describe the blocker in the PR or on the issue, not in a code comment.
- Your final message reports what you completed and any blockers — nothing else.
