# MSc Dissertation Proposal (v2 — revised after critique)

## Where Does Pre-Extraction Beat Retrieval? A Crossover Study of Claim-Graphs vs. RAG for Conflict-Aware Summarisation

**Working title.** *The extraction-tolerance crossover: when does ingest-time structured extraction beat strong retrieval (and long-context) for grounded, conflict-aware summarisation — and how much extraction error can it survive?*

> **What changed from v1 and why.** v1 asked "does my claim-graph beat naive RAG?" — an experiment rigged to win and therefore uninteresting. This version asks *where the two architectures cross over*, makes **extraction error the central variable** (not a footnote), makes **strong RAG and long-context mandatory baselines** (not stretch goals), and **de-rigs the data** so the result can come out against the claim-graph. The contribution is now a *finding about a trade-off*, not an advocacy demo.

---

## 1. The honest problem statement

Grounding LLM summaries in a private, multi-source corpus (Slack + Jira + docs) has two architectures:

- **Retrieve at query time (RAG):** fetch top-*k* similar passages, generate over them. Recall is probabilistic; cross-source contradictions are usually not noticed.
- **Extract at ingest time (claim-graph):** parse every artifact once into typed, attributed *claims*; detect contradictions as a database constraint over claims; let the LLM only re-render verified facts.

The seductive but **false** selling point of the claim-graph is "100% recall by construction." It is not: recall is 100% *only if extraction is perfect*. In reality the claim-graph **moves the recall problem from the retriever to the extractor**. So the real scientific question is not "which wins" — it is:

> **How good does extraction have to be, and how large/messy does the corpus have to be, before pre-extraction beats strong retrieval and long-context stuffing? And where does it lose?**

That crossover is unknown in the literature, falsifiable, and can come out either way. That is what makes it research rather than a product report.

---

## 2. Research Questions

- **RQ1 — Extraction-tolerance (the headline).** As extraction precision/recall degrades from perfect to realistic, at what point does the claim-graph's conflict-recall and faithfulness advantage disappear? Is there a usable operating region, or does the advantage collapse under realistic extraction error?
- **RQ2 — Corpus-size crossover.** As corpus size grows (and as it shrinks small enough to fit a long-context window), where does each architecture win on conflict recall and faithfulness? *Specifically: does long-context stuffing — which also has 100% recall on small corpora, for free, with no extractors — dominate the claim-graph below some size threshold?*
- **RQ3 — Paraphrase/entity-resolution stress.** The hard part of real data is that "launch date," "go-live," and "the Q2 release" are the *same* fact written differently. As paraphrase/aliasing rate rises, how do (a) the claim-graph's extractor and (b) retrieval-based arms degrade?
- **RQ4 — Attribution via ablation.** When the claim-graph wins, *which component* caused it — the structured extraction, the SQL conflict check, or the NLI faithfulness gate? Ablations isolate the cause so the finding is mechanistic, not "the whole bundle was better."
- **RQ5 — Cost honestly accounted.** Per-summary marginal cost *and* amortised cost including ingest-time compute and a documented estimate of extractor-development effort, across the size sweep — versus RAG with cheap-model / caching optimisations applied (so RAG is not handicapped).

RQ1 is the contribution. The field does not know the answer and it cannot be guessed from existing papers.

---

## 3. Method

### 3.1 Arms — strong baselines are mandatory, not optional

| Arm | Description | Status |
|---|---|---|
| **A — Claim-graph** | Existing pipeline: extraction (`claims/extract.py`) → SQL drift (`drift/evaluate.py`) → skeleton (`agent/skeleton.py`) → constrained render (`agent/render.py`) → NLI gate (`agent/nli.py`). | Built; instrument + ablate. |
| **B — Strong RAG** | Embeddings **+ reranker + query rewriting**, generate-with-citations. *Not* naive top-*k* — a 2023 strawman is disallowed. | **Build (mandatory).** |
| **C — Long-context** | No retrieval: put the entire (small) corpus in the prompt, generate-with-citations. The honest "free 100% recall" competitor the claim-graph must beat. | **Build (mandatory).** |
| **D — Naive RAG** | Top-*k* only. Included **solely** as a floor/sanity reference, not as the comparison that carries the thesis. | Build (cheap). |

All arms share the same LLM, corpus, prompt budget, and citation requirement, so the architecture is the independent variable. Arms B and C are the comparisons that can *defeat* the claim-graph — including them is what makes the study fair.

### 3.2 De-rigging the data

The v1 plan let one author write the corpus, inject the conflicts, *and* write the extractors — a self-fulfilling loop. Fixes:

1. **Adversarial paraphrase by construction.** The corpus generator expresses each ground-truth fact through *varied* surface forms and aliases (controlled by a tunable paraphrase rate for RQ3), so the extractors cannot assume the phrasings they were written for.
2. **Author separation.** Ground-truth facts/conflicts are specified in a schema *independently* of the extractor regexes; the person/process seeding phrasings does not get to see and match the extractor patterns. (Where solo, enforce via a frozen extractor set predating corpus generation.)
3. **A real-data slice is required, not optional.** At least one consented/public messy multi-source corpus (e.g. a public Slack/Jira/mailing-list export, or own data under UCL ethics) for a replication of RQ1–RQ3 at smaller scale. Synthetic-only is treated as a *threat to validity*, not a result. **Ethics/data path cleared by week 3 or the project pivots.**
4. **Held-out extractors are not tuned on the eval corpus.** No peeking; extractor versions are frozen before the corpus they're scored on is generated.

### 3.3 Metrics

- **Conflict recall/precision/F1 (RQ1–RQ3):** surfaced conflicts vs. injected ground-truth conflicts, as functions of extraction quality, corpus size, and paraphrase rate.
- **Faithfulness (RQ1, RQ2):** per-sentence entailment against cited sources. **Measured by independent human labels** (primary) — *not* by the NLI verifier that lives inside Arm A, to avoid grading the system with its own component. The NLI verifier is itself *evaluated* against the human labels (reported as agreement), never used as the headline metric.
- **Extraction precision/recall per kind (RQ1):** the x-axis of the headline result; degraded synthetically to trace the tolerance curve.
- **Cost/latency (RQ5):** marginal + amortised, tokens + $ + wall-clock, with RAG given its fair optimisations.

### 3.4 Attribution (RQ4)

2×2×2 ablation over {structured extraction, SQL conflict check, NLI gate} on a fixed corpus, so a claim-graph win can be attributed to a *mechanism* rather than to the bundle. Kept small (one corpus size) to bound cost.

### 3.5 Evaluation harness

A reproducible harness (new work, core deliverable) that runs all arms over a corpus, sweeps extraction-quality / size / paraphrase, collects every metric, and emits the tables/plots. This harness is what makes the results credible and is itself a contribution.

---

## 4. What a "good" result looks like (and that it can be negative)

The dissertation succeeds whether or not the claim-graph wins:

- **Positive finding:** "Pre-extraction beats strong RAG and long-context on conflict recall *above* corpus size N *and* extraction F1 above τ; below that, long-context dominates." → a usable engineering rule + a measured crossover.
- **Negative finding (equally publishable):** "Under realistic extraction error and paraphrase, the claim-graph's recall advantage collapses and long-context wins for any corpus that fits the window." → an honest, valuable refutation of the architecture's own marketing.

Designing so the *null result is still a contribution* is what removes the "rigged to win" objection entirely.

---

## 5. Scope

**In:** strong-RAG + long-context + naive baselines; de-rigged synthetic generator with paraphrase control; real-data slice; extraction-degradation sweep; human faithfulness labelling; ablations; harness.

**Out (explicitly):** new connectors, operator-override/pattern-learning track, UI, multi-tenancy, production ops. Product features, not research.

**Deliverables:** baselines + harness; de-rigged dataset + generator + real-data slice; RQ1–RQ5 results incl. a negative-result-tolerant crossover analysis; write-up.

---

## 6. Revised 12-Week Timeline (engineering front-loaded, results protected)

| Week | Focus | Output |
|---|---|---|
| 1 | Lit review (GraphRAG, HybridRAG, FaithfulRAG, contradiction-detection, long-context grounding). Lock RQs. | Bibliography; final RQs |
| 2 | Corpus generator with paraphrase control + ground-truth schema, author-separated from extractors. | Generator v0 |
| 3 | **Ethics/real-data decision (hard gate).** Build strong-RAG (B) + long-context (C) + naive (D) arms. | Data path cleared; all baseline arms running |
| 4 | Evaluation harness: run all arms, collect tokens/latency/outputs. | Harness v1 |
| 5 | Human faithfulness labelling protocol; label held-out sentences; measure NLI-vs-human agreement. | Gold labels; agreement stats |
| 6 | **RQ1** extraction-tolerance sweep (degrade extraction, trace the crossover). | Headline curve |
| 7 | **RQ2** corpus-size crossover incl. long-context dominance test. | Size-crossover result |
| 8 | **RQ3** paraphrase/entity-resolution stress. | Robustness result |
| 9 | **RQ4** ablations (attribute the cause). | Mechanism result |
| 10 | **RQ5** honest cost accounting + **real-data replication** of RQ1–RQ3. | Cost result; external-validity check |
| 11 | Write-up: method, results, crossover analysis, threats to validity. | Full draft |
| 12 | Revise on feedback; reproducibility pass; submit. | Final dissertation |

Baselines now land by week 3 and the headline experiment by week 6 — so if the back half slips, there is still a defensible result, not a panic.

---

## 7. How this version answers each supervisor objection

| Objection (v1) | Fix (v2) |
|---|---|
| "100% recall is circular — extraction can fail." | Made the **central variable** (RQ1): measure exactly how much extraction error the advantage survives. |
| "Experiment rigged to win." | De-rigged data (author separation, adversarial paraphrase, real-data slice) + **negative result is a valid outcome** (§4). |
| "Strawman baseline." | Strong RAG **and** long-context are **mandatory** arms that can defeat the claim-graph (§3.1). |
| "Not novel — structure-beats-naive-RAG is known." | Contribution is the **crossover / tolerance curve**, which is unknown — not "structure wins." |
| "Confounded — can't attribute the win." | RQ4 **ablations** isolate extraction vs. SQL-check vs. NLI gate. |
| "Contaminated evaluation (NLI inside the system)." | Faithfulness scored by **independent human labels**; NLI is *evaluated*, never the headline metric. |
| "Cost claim is marketing." | RQ5: **amortised + marginal**, includes ingest + extractor-dev cost, RAG given fair optimisations. |
| "Generalisability ≈ zero." | Reframed as an explicit boundary finding: *the contribution is characterising **when** the narrow, schema-known regime pays off* — the limit is the result, not a flaw. |
| "Too much plumbing, results too late." | Timeline front-loads baselines (wk 3) and headline experiment (wk 6), so a late-stage slip still leaves a defensible result. |

---

## 8. Remaining open questions for the supervisor

1. Is the **crossover/tolerance framing** the contribution you want, or would you prefer it pushed toward a **hybrid method** (claim-graph for conflict detection layered on retrieval for open-ended recall)?
2. Which **faithfulness metric/benchmark** does the department consider credible, for comparability with published work?
3. Is a **public real-data corpus** acceptable for the §3.2 real-data slice, or must it be original data under full ethics review (which lengthens week 3)?
