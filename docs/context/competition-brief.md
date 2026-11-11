# Research brief: shared by every research agent

## Competition facts (captured 2026-11-06 from the live event page; raw text in `research/raw/`)
- **Event**: Future Health Digital Innovation Challenge, hosted on hack2skill.com/event/futurehealthchallenge. It is run by "Future Health – A Global Initiative by Abu Dhabi". Co-creators are Microsoft, Inception (G42) and MBZUAI; the "Collaborator" logo is unnamed. The platform is Hack2skill.
- **Prizes**: USD 50k / 35k / 20k. The top 3 present at GITEX 2026 (7–11 Dec). Selected solutions get a "readiness assessment and potential pathway beyond".
- **Dates**: registration closes **10 Nov 2026**. A **working prototype + technical documentation + assumptions, dependencies, limitations** is due **20 Nov 2026**. Evaluation runs 20–30 Nov. Today is 2026-11-06, which leaves about 12–14 build days.
- **Judging** (no weights): Health impact & clinical relevance · Technical depth & architecture · Working solution & demonstration quality · Responsible AI, safety & data governance · Scalability & deployment readiness · Commercial viability & path to pilot.
- **Data (FAQ, verbatim)**: "The organisers will not provide any data, including synthetic data. Use only data you have the legal right to use, declare every data source, and avoid personal data you do not need."
- **IP**: the FAQ says the team retains IP. The Terms, however, grant the Organiser a 6-month right of first refusal on any exclusive licence, plus a perpetual non-exclusive marketing licence.
- **Team**: 1–5 people, online. Our team is 1–2 people: an AI engineer (Python 3.13/FastAPI, LLMs, ML) plus Next.js (maybe three.js). Local GPU: RTX 3080 Laptop with 16 GB.

## Method rules
- Use real WebSearch + WebFetch of **primary sources**. Never cite from memory. Every quantified claim needs a fetched URL. If a search or fetch fails, say so; never invent.
- Verify that a citation is about the *exact* product, dataset or law you name.
- For datasets, record: licence, access friction (instant download vs credentialed approval; anything that takes weeks is **infeasible** for this timeline), size, relevance, and a feasibility rating.
- Conventions win over this brief. If anything here is wrong, say so plainly. I'd rather be corrected than obeyed.

## Deliverable format (Obsidian, Compendium vault)
- Folder: `C:\Users\LEGION\Documents\Compendium\Ali\Future-Health-Challenge\Challenges\` (or the exact path given in your task).
- YAML frontmatter:
  ```yaml
  ---
  type: reference
  title: <Title>
  description: "<one substantive sentence>"
  status: active
  created: 2026-11-06
  updated: 2026-11-06
  tags: [future-health-challenge, <topic-tags>]
  related:
    - "[[Future Health Challenge]]"
  ---
  ```
- Use wikilinks by **basename only** (`[[Future Health Challenge]]`), never path-prefixed. **Don't hard-wrap paragraphs**: one paragraph per line. Use tables where they help.
- Per-challenge note sections:
  1. Challenge (verbatim, from the raw file)
  2. Decode & requirements matrix: each numbered "Your solution should" item → concrete features and evidence the judges will look for
  3. Local context (Abu Dhabi / UAE programmes, stats, regulators, cultural/linguistic needs)
  4. Clinical / scientific evidence & guidelines, plus validated instruments
  5. Data sources (table: name · URL · licence · access · size · use · feasibility)
  6. Competitor / existing-solution landscape and the remaining gap
  7. Solution options (2–3 concrete architectures on FastAPI + Next.js + ML/LLM)
  8. Recommended MVP buildable in about 12 days by 1–2 people. Map it to every "should" item and describe how "demonstrable value" is shown on simulated or realistic cases (metrics).
  9. Judging-criteria scorecard (1–5 per criterion, with reasons) + build-risk + win-likelihood
  10. Risks & open questions (clinical safety, SaMD/regulatory, data, privacy)
  11. Verdict (one paragraph)
  12. Sources (numbered URLs)
  13. See Also (2–5 basename wikilinks)
- Write only the files named in your task. **No git commands.** Do not touch other files.
- Final reply to the controller: under 250 words, covering the verdict, the best data source(s), and any corrections to this brief.
