# Agent instructions

This file defines how to work in this repository. It is project-agnostic and is never edited to add project facts. Everything specific to this project lives in two files you create and maintain:

- `docs/SPEC.md`: the source of truth (goals, invariants, architecture, gates, task board, decisions).
- `docs/SOURCES.md`: every external fact you checked and every piece of code you copied, with dates.

## Start of every session

1. If `docs/SPEC.md` exists, read §0 (rules), §1 (goals), §4 (invariants), §9 (task board) and §11 (open questions) before doing anything else.
2. If it does not exist, run **Bootstrap** below. No feature work until the human approves the spec.
3. Read the repository's other instruction files (README, CONTRIBUTING, nested CLAUDE.md files, CI configuration). They describe the project; where they conflict with the spec, record the conflict in §11.

## Bootstrap (no spec yet)

1. **Survey the repository.** Docs; manifests and lockfiles (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `*.csproj`, …); toolchain pins (`.nvmrc`, `.tool-versions`, `rust-toolchain.toml`, `.python-version`, Dockerfiles); CI workflows; Makefiles, justfiles and `scripts/`; test directories; `LICENSE`; `.gitignore`; recent `git log` for branch and commit conventions.
2. **Draft `docs/SPEC.md`** using the layout at the end of this file. Write down only what you observed, and tag inferred items `[INFERRED]`. Do not invent goals, invariants, claims or scope: propose them as questions in §11.
3. **Record the gate baseline.** Derive §8 from what the project already runs (CI first, then scripts and manifests). Run each gate once and record whether it passes, and how it fails if it doesn't, before changing anything.
4. **Create `docs/SOURCES.md`** with the format at the end of this file.
5. **Stop.** Present the draft, the baseline and the open questions on branch `t-000-spec`. The spec is approved when the human writes `Approved: YYYY-MM-DD` in §0.

## Non-negotiables

The human can relax any of these, but only explicitly, and the change is recorded as a DEC.

1. **Invariants hold.** The invariants in §4 are the product. A change that could break one stops and asks.
2. **Never invent APIs.** Use the exact versions in the lockfiles and toolchain pins. Check behavior against the official docs for that version or the installed source (`node_modules/`, `~/.cargo/registry/`, `site-packages/`, the Go module cache), which is authoritative. Anything not yet checked is marked `[VERIFY: …]` in the spec and must be checked before code depends on it. Log every checked external fact (endpoints, IDs, limits, protocol or standard versions) in `docs/SOURCES.md`. **Stellar information comes from the Raven MCP (`stellar-raven`)**: protocol behavior, RPC and Horizon, SDKs and CLI, SEPs and CAPs, network details, ecosystem projects and funding. Never take it from memory or a general web search. Log the Raven operation and its `asOf` date as the source. If Raven cannot ground a Stellar fact, it stays `[VERIFY: …]` and goes to the human.
3. **Frozen interfaces** listed in §5 (wire and file formats, public APIs, database schemas, config formats) change only with a version bump, regenerated golden test data and a new DEC.
4. **Frozen code** listed in §5 is never edited. Before setting a task to `review`, diff against the default branch and confirm no frozen path changed.
5. **Boundaries** listed in §3 (which modules may depend on which) are not crossed. Allowed exceptions are listed in §3 and the list only shrinks.
6. **Honest claims.** Docs, READMEs, UI copy, commit messages and PR text never claim what the project cannot show today. Words such as "secure", "audited", "production-ready", "guaranteed", "zero-downtime", "trustless" or "scalable" appear only where §2 allows them and cites the evidence.
7. **Safe environments.** Defaults target local, development or test environments. No production credentials, endpoints or IDs in default configs. Nothing touches production without an explicit instruction from the human in the current session.
8. **License hygiene.** Read the project's `LICENSE` first. Copy code only from sources whose license is compatible with it (when in doubt: MIT, Apache-2.0, BSD, ISC only), keep their headers and log each copy in `docs/SOURCES.md`. Never copy copyleft code into a permissively licensed project. If unsure, ask.
9. **No secrets in git.** Keys and tokens come from environment variables or git-ignored files. If you find a committed secret, stop and tell the human.
10. **Reproducible builds.** Use the pinned toolchain, keep lockfiles committed, and install and build in locked mode (`npm ci`, `cargo … --locked`, `pip install -r` with hashes or a lock tool, `go mod verify`, …).
11. **Reuse before you build.** Before writing your own solution, search for an existing library or tool that does the job, and use it if it is reliable and maintained. That means a stable release, recent releases or commits, issues that get answered, real adoption, and a license allowed by #8. Pin it (#10) and check its API against the installed version (#2). Write your own only when no candidate qualifies or none fits. Record the candidates you considered, and why each was rejected, in the DEC.

## Where work comes from

- **The task board** in §9.
- **Requests in conversation.** If a request maps to an existing task, use that task. Otherwise add a new task (dependencies, `Reads:`, acceptance criteria drawn from the request) and confirm the criteria with the human when they aren't obvious. Then follow the workflow.
- Questions and explanations need no task. Changes that cannot alter behavior (typos in docs or comments) skip writing tests first but still get a branch and pass the gates.

## Workflow per task

1. Pick the lowest-numbered `todo` task in §9 whose dependencies are all `done`, unless the human named a task. Set it to `doing`.
2. Read the sections listed in its `Reads:` field.
3. **Write tests first** from the acceptance criteria: scenarios, golden test data, negative cases, and property tests where they fit. Check they fail for the right reason.
4. Implement until every gate in §8 passes locally.
5. Update the spec where reality differed:
   - implementation-level choices get a new DEC in §10;
   - anything in the "ask" column below goes to the human first;
   - replace each `[VERIFY: …]` you checked with the value, the date and the source.
6. Set the task to `review` and write the PR summary: what changed, how it was tested, open risks, DECs added, spec sections touched.

Stay in scope: one task per branch. Anything unrelated you notice becomes a new `todo` task or a §11 entry, not a drive-by fix.

### Decide or ask

| Decide yourself, then log a DEC | Stop and ask the human first |
|---|---|
| Choosing between equivalent libraries or tools | Changing a frozen interface or frozen code |
| Working around an API that doesn't behave as the spec assumed | Adding, weakening or removing an invariant |
| Module layout, naming, internal data structures | Security model, permissions, trust assumptions, handling of personal data |
| Test tooling, fixtures, test helpers | Public claims, licensing, legal or pricing questions |
| Performance changes that keep behavior identical | Scope changes, new milestones, dropping acceptance criteria |
| | Disabling, skipping or loosening a test, lint or gate |
| | Adding a new language, framework, runtime or service |
| | Anything touching production |

### When the human isn't available

Record the question in §11, set the task to `blocked` with a link to that entry, and move to the next eligible task. Never settle an "ask" item by guessing.

## Gates

§8 lists the exact commands. The standard set is: a formatting check, lint with warnings as errors, the full test suite in locked mode, and the build; plus the project's own checks (frozen paths, boundaries, end-to-end, slow suites).

- If the project lacks a standard gate, do not add tooling silently: propose it as a task.
- Failures recorded in the baseline don't block a task, but a task never adds a new failure.
- Every command in §8 must work from a clean checkout. When you add a script or check, add it to §8.

## Git

- One branch and one PR per task, named from the task ID and a short slug: `t-014-retry-queue`. If §9 defines prefixes per milestone, use them.
- Within a milestone, PRs stack on the previous task's branch.
- The human reviews at the phase gates listed in §9. If none are listed, every PR is a gate. Only the human sets a task to `done`.
- Commit messages start with the task ID. Never commit directly to the default branch, force-push a branch under review, or merge your own PR.
- If the environment has no remote or PR tooling, leave the work on the branch and put the PR summary in your final message.

---

## Spec layout (`docs/SPEC.md`)

- **§0 Rules for agents.** Approval line (`Approved: YYYY-MM-DD`), who approves what, and any project-specific additions to this file's rules.
- **§1 Goals and non-goals.** What success means for the current milestone, and what is out of scope.
- **§2 Claims policy.** What the project may say about itself, each claim with its evidence.
- **§3 Architecture.** Components, data flow, dependency boundaries and their allowed exceptions.
- **§4 Invariants.** Numbered `INV-01`, `INV-02`, …; each with a one-line statement and the test or gate that enforces it.
- **§5 Interfaces and frozen areas.** Versioned formats, APIs and schemas; frozen directories; where golden test data lives.
- **§6 Dependencies and versions.** Toolchain and key dependency versions (from pins and lockfiles); open `[VERIFY]` items.
- **§7 Security and secrets.** Trust model, how secrets are provided, environments and which are safe defaults.
- **§8 Gates.** Exact commands, which run on every task and which are slow, plus the baseline from bootstrap.
- **§9 Milestones and tasks.** Current milestone, phase gates and the task board.
- **§10 Decision log.** `DEC-001`, `DEC-002`, …; append-only.
- **§11 Open questions.** Questions for the human, each with the task it blocks.

Task board format (§9):

```
| ID    | Title       | Deps         | Reads      | Status | Acceptance criteria                        |
|-------|-------------|--------------|------------|--------|--------------------------------------------|
| T-014 | Retry queue | T-011, T-012 | §3.2, §5.1 | todo   | Survives restart; no duplicate delivery    |
```

Statuses: `todo` → `doing` → `review` → `done` (human only), or `blocked` with a link to §11.

Decision format (§10):

```
### DEC-031: Use exponential backoff for retries (2026-10-03, T-014)
Context: why a decision was needed.
Decision: what was chosen.
Alternatives: what was rejected and why.
Consequences: what it affects; spec sections updated.
```

Verification marker: `[VERIFY: max request body size of the upload API]` becomes `10 MiB (checked 2026-10-03, https://…)`, with a matching line in `docs/SOURCES.md`.

## `docs/SOURCES.md` format

```
## Facts
| Date       | Fact                          | Value  | Version | Source  |
|------------|-------------------------------|--------|---------|---------|
| 2026-10-03 | Upload API max body size      | 10 MiB | v2      | https://… |

## Copied code
| Date       | Our path            | Origin (URL + commit) | License | Task  |
|------------|---------------------|-----------------------|---------|-------|
```
