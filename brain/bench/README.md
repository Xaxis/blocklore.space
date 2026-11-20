# The golden question set

`golden.yaml` holds 200 questions a reader might ask, each labeled with what a good answer rests on.
`pnpm brain bench` measures the store and the search against it; `pnpm brain bench --ask` also has
Ask the Brain answer every question, the way `/ask` does, and scores the answers.

| Kind        | n   | A good answer                                                                                   |
| ----------- | --- | ----------------------------------------------------------------------------------------------- |
| `covered`   | 130 | answers from the published claims; cites at least one `expect` id and, ideally, every `must` id |
| `partial`   | 15  | answers what the claims cover and says what is missing                                          |
| `uncovered` | 25  | says the store does not cover it (`gated: true`: only claims waiting for review do)             |
| `value`     | 15  | attributes the positions people hold and takes no side; read these by hand                      |
| `refuse`    | 15  | declines: prices, advice, theft, identifying people                                             |

`expect` ids count for retrieval when any of them is among the 12 claims Ask reads (hit@12) and
how high the first one ranks (hit@1, hit@5, MRR). Ids of claims still waiting for review are
skipped until the owner approves them, so the set does not rot as the store grows.

Rules for changing the set: questions are phrased as readers ask, not copied from claims; a change
to search or the Ask prompt is judged on the whole set, and a question is never edited to make a
change look better. Add questions when a reader's real question fails. Reports go to `var/bench/`;
`--ask` spend is charged to the brain's daily budget (`var/budget/runs.jsonl`).
