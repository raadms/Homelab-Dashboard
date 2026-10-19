# Agent Team

A fifteen-role software delivery team, defined as Claude Code subagents. Each file in
`agents/` describes one specialist: what it owns, the standards it holds itself to, and the
format its output takes. They are general-purpose — they carry no product, company, or domain
assumptions, and they adapt to whatever project they are dropped into.

## Installation

Copy the `agents/` folder into your project as `.claude/agents/`, or into `~/.claude/agents/`
to make the team available across all your projects. Each agent is then invocable by name.

## The team

| Agent | Name | Owns |
|---|---|---|
| `orchestrator` | Omar | Planning, task assignment, and validation of every other agent's output |
| `codebase-explorer` | Khalid | Mapping unfamiliar code — architecture, conventions, hazards, real coverage |
| `solutions-architect` | Sami | System design, tech decisions, data models, API contracts, ADRs |
| `business-analyst` | Basma | Requirements, acceptance criteria, state machines, edge cases |
| `business-development` | Badr | Market research, positioning, pricing, go-to-market, feature ROI |
| `ux-designer` | Noura | Flows, wireframes, design tokens, interaction states, interface copy |
| `backend-developer` | Bandar | Server-side implementation, database, APIs, integrations, background jobs |
| `frontend-developer` | Wael | Web applications and admin portals, components, forms, tables, accessibility |
| `mobile-developer` | Mishal | Client application implementation, UI, state, offline, platform integration |
| `data-engineer` | Reem | Event schema, instrumentation, pipelines, dashboards, experiments, analysis |
| `security-engineer` | Faisal | Threat modeling, auth review, secure code review, secrets policy, dependency risk |
| `reliability-engineer` | Tariq | Load testing, performance budgets, SLOs, incident response, runbooks, postmortems |
| `qa-tester` | Qusai | Test plans, automated suites, exploratory and adversarial testing, bug reports |
| `quality-engineer` | Nawal | Code review, standards as tooling, CI quality gates, audits, release readiness |
| `devops-engineer` | Dana | Repository, CI/CD, environments, secrets mechanism, telemetry, backups, cost |

Each agent signs its output with its name, so in a multi-agent session you can always tell
who produced what.

## How to use them

On an existing codebase, start with the **codebase explorer** — nobody should edit code the
team has not mapped.

Then, for a feature:

1. **Orchestrator** breaks the request into tasks with owners and an explicit Definition of
   Done for each.
2. **Business analyst** writes the requirements and acceptance criteria.
3. **Solutions architect** settles the design, data model, and API contract, and records an
   ADR.
4. **Security engineer** threat-models anything touching authentication, money, personal
   data, uploads, or an external service — before it is built, not after.
5. **Data engineer** defines the events and metrics while the feature is still being
   specified, so the measurement exists on the day it ships.
6. **UX designer** produces the flows, states, and screen specifications.
7. **Backend**, **frontend**, and **mobile** developers implement against the agreed
   contracts.
8. **QA tester** executes the test plan and reports findings.
9. **Quality engineer** reviews the diff and checks release readiness.
10. **Reliability engineer** load-tests anything expecting real traffic and confirms the
    failure modes are known before launch.
11. **DevOps engineer** handles the pipeline, environments, and deployment.
12. **Orchestrator** validates everything against the original ask and returns a verdict.
13. **Data engineer** reads the numbers afterwards and reports whether it worked.

You do not need all fifteen for small work. A bug fix might only need the relevant developer,
QA, and the orchestrator. But the orchestrator should see anything that matters, and the
security engineer should see anything that touches a trust boundary.

## A note on the orchestrator

The orchestrator is deliberately adversarial. It re-runs claims rather than believing them,
opens the files that were said to have changed, diffs delivered work against the original
request, and rejects output that shows the signatures of unfinished work — unrun tests,
placeholder implementations, assertions that cannot fail, silently dropped acceptance
criteria, and confident summaries with no evidence behind them.

This is intentional. Use it as the last step before you accept anything.

## Overlapping coverage, single authority

Several agents apply security rules: the architect designs to them, the backend developer
builds to them, the quality engineer checks them on every diff. That redundancy is deliberate
— a mistake has to slip past several independent readings. What is not left ambiguous is who
decides: the **security engineer** owns security policy and holds the deciding vote when two
agents disagree.

The same pattern applies elsewhere. Accessibility and internationalization appear in five
files, but with different verbs — the designer specifies, the client developers implement, QA
tests, the quality engineer audits for gaps. Testing appears in three — QA writes and runs
them, the quality engineer sets the coverage floor and judges whether a test could actually
fail, the orchestrator checks that any coverage claim came with a command.

Where two roles could plausibly claim the same decision, the boundary is stated in both
files:

- **Secrets** — DevOps owns the mechanism (where they live, how they are injected, how
  rotation is performed); security owns the policy and the audit.
- **Metrics** — the analyst states the metric and the question; the data engineer designs the
  events and pipelines that answer it.
- **Failure** — QA tests correctness for a user; the reliability engineer tests behaviour
  under load and during dependency failure.
- **Incidents** — security incidents belong to the security engineer, everything else to the
  reliability engineer.
- **Telemetry** — DevOps builds and operates it; the reliability engineer sets the thresholds
  and service level objectives.
- **Code understanding** — the explorer maps code the team does not yet understand; the
  quality engineer audits code the team actively maintains.

## Who reviews what

Four agents review, and they do not overlap in authority:

- **Quality engineer** reviews the *code* — correctness, structure, standards, test quality.
- **Security engineer** reviews the *trust boundaries* — who can do what to whose data.
- **Reliability engineer** reviews the *failure modes* — what happens under load and when a
  dependency dies.
- **Orchestrator** reviews the *delivery* — did this actually satisfy what was asked, and is
  the evidence real.

QA sits apart from all four: it tests the running product rather than reading the diff. The
data engineer closes the loop after release, answering whether the shipped thing moved the
number it was supposed to move.

## Conventions the agents share

They expect, and will create, a documentation structure along these lines:

```
docs/
  codebase-map.md   # written by the explorer on an inherited project
  requirements/     # one file per feature, plus open-questions.md
  decisions/        # architecture decision records, NNN-title.md
  security/         # threat models, one per sensitive feature
  analytics/        # tracking plan and analyses
  reliability/      # performance budgets, runbooks, post-incident reviews
  test-plans/       # one file per feature
  bugs/             # one file per bug
  business/         # strategy and market documents
  brand.md          # design tokens
  infra.md          # infrastructure that cannot be inferred from the repo
  PROJECT_STATUS.md # maintained by the orchestrator
```

Every agent is expected to report what it actually ran and what it actually observed —
never a claim without the evidence behind it.

## Known gaps

Two areas are deliberately unowned. **Documentation** beyond what each role writes for itself
— connective guides, onboarding, and editorial consistency — is distributed rather than owned.
**Roadmap prioritization** across competing features has no single owner: the orchestrator
sequences what is asked for, business development judges growth impact, but nobody decides
what to build next. Both are judged smaller costs than the routing ambiguity another agent
would add.
