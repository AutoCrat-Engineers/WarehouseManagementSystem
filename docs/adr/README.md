# Architecture Decision Records (ADRs)

This directory contains the history of significant architectural decisions made on the WMS codebase.

## Why ADRs?

An ADR captures **one decision**, **its context at the time**, **the forces weighed**, and **the consequences accepted**. They form an immutable audit trail: a new engineer can read them in order and understand *why* the system looks the way it does, not just *what* it looks like.

## When to Write One

Create a new ADR whenever the team makes a decision that:

- Changes how modules communicate (API boundaries, messaging, transactions)
- Introduces a new technology, library, or external service
- Reverses a previous decision
- Affects security, data integrity, or performance in a non-local way
- Is likely to be questioned months later ("why did we do it this way?")

Do **not** write an ADR for:
- Bug fixes
- Refactors that don't change architecture
- Dependency bumps
- Style/lint changes

## Format

All ADRs follow the [MADR](https://adr.github.io/madr/) format. Start from [`0000-template.md`](./0000-template.md), copy to a new file with the next sequential number, and commit alongside the PR that implements the decision.

## Numbering

Files are named `NNNN-kebab-case-title.md` where `NNNN` is zero-padded. Numbers are permanent even if the ADR is superseded. Superseded ADRs are kept (not deleted) with their status set to `Superseded by ADR-XXXX`.

## Index

| Number | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-edge-function-sm-prefix-and-jwt-auth.md) | Stock Movement edge function prefix + JWT handling | Accepted | 2026-04-18 |

## Adding a New ADR

```bash
# Copy the template
cp docs/adr/0000-template.md docs/adr/00XX-your-title.md

# Fill it out, link it from the index above, commit with your PR
```
