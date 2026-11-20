# Review

The owner reads the claims the gate held and approves or rejects them; nothing else can.

<!-- covers: cli:review -->

## Sub-features

- list: held claims by topic with their statement and why they were held.
- show: one held claim in full, with its verdict and check method.
- approve: adds a review record, publishes, commits (owner only).
- reject: removes it with a reason (owner only).

## How to reach it

- `pnpm review list`, `pnpm review show <id>`, `pnpm review approve <id...>|--topic <slug> [--note ...]`, `pnpm review reject <id> --reason ...`.

## How to check it

Static: `pnpm lint`.

Runtime (read-only):

```sh
pnpm -s review list | head -20
python3 -I -c "import json;print(sum(r['count'] for r in json.load(open('knowledge/review-queue.json'))))"
ls var/review/claims | wc -l
```

Proves it when: the list shows each held claim with "held: ..." reasons, and the public count in `knowledge/review-queue.json` equals the number of files in `var/review/claims`.

## Gotchas

- Never run approve or reject: that decision is the owner's (CLAUDE.md).
- Held text never enters the public repo; only per-topic counts do.
