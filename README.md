# 🤖 AI UI Tester

**Model-agnostic AI-powered UI automation. Write tests in plain English. Trigger them with GitHub webhooks. Get comprehensive HTML reports with screenshots, AI reasoning, and pass/fail verdicts.**

Works with Anthropic Claude, OpenAI GPT, and any OpenAI-compatible endpoint — including local models via [Ollama](https://ollama.com), LM Studio, vLLM, or llama.cpp.

```text
specs/login.spec.md      ──▶  GitHub webhook / API / CLI
                                       │
                                       ▼
                          LLM agent (vision + tool use)
                          Claude · GPT-4o · Ollama · ...
                                       │
                                       ▼
                              Playwright (Chromium)
                                       │
                                       ▼
                  HTML report + JSON + SQLite history
```

## What makes this different

Most UI test frameworks force you to write brittle CSS selectors. This one lets the AI **see** the page (vision) and **decide** what to do — so your tests look like a tester's notebook, not a fragile XPath dump.

```markdown
- Click the "Sign in" button.
- Type "alice@example.com" into the email field.
- Verify the dashboard shows "Welcome, Alice".
```

That's it. No selectors, no waits, no element IDs. The agent figures it out from a screenshot + accessibility tree.

## Features

- **Plain-English specs** — Markdown files with `## Steps` and `## Expectations` bullet lists.
- **Vision-driven** — Every action returns a screenshot to Claude, who verifies the result before the next step.
- **Webhook triggers** — GitHub `push` and `pull_request` events route to spec sets via tags (`smoke`, `pr`).
- **Manual API** — `POST /runs {"specId": "..."}` to fire a run.
- **CLI** — `npm test specs/login.spec.md` for local runs.
- **Comprehensive reports** — Per-step screenshots, AI reasoning traces, expectation verification, token usage. Self-contained HTML.
- **Persistent history** — SQLite-backed run database with a built-in dashboard at `/`.
- **Prompt caching** — System prompt and tool definitions cached across runs for cost efficiency.

## Quick start

```bash
# 1. Install
npm install
npx playwright install chromium

# 2. Configure
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY

# 3. Run a sample test
npm test specs/example-login.spec.md

# 4. Or start the server
npm run server
# → Dashboard: http://localhost:3000
```

## Writing a spec

Drop a markdown file into `specs/`:

```markdown
---
name: Checkout flow
baseUrl: https://shop.example.com
tags: [smoke, pr]
---

## Description
Verify a logged-in user can complete checkout with a saved card.

## Steps
- Open the home page.
- Click on the first product card.
- Click the "Add to cart" button.
- Click the cart icon in the header.
- Click "Checkout".
- Click "Place order".

## Expectations
- The order confirmation page should display an order number.
- The page should show the product that was added.
- A confirmation email notice should appear.
```

The frontmatter (`name`, `baseUrl`, `tags`) is optional. Steps and expectations are bullet lists in plain English.

## Triggering tests

### Via CLI

```bash
npm test specs/login.spec.md                          # one spec
npm test -- list                                      # list specs
npm test -- all --base-url https://staging.example.com  # all specs
```

### Via API (manual trigger)

```bash
curl -X POST http://localhost:3000/runs \
  -H 'Content-Type: application/json' \
  -d '{"specId": "example-login"}'
```

### Via GitHub webhook

In your GitHub repo: **Settings → Webhooks → Add webhook**

- Payload URL: `https://your-host/webhooks/github`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET` in `.env`
- Events: `push` and `pull_request`

Spec selection by event:

- **push to `main`** → specs tagged `smoke`
- **pull_request** → specs tagged `pr`
- otherwise → all specs

## Choosing an LLM provider

Set `LLM_PROVIDER` in `.env` to switch backends. The agent's behavior, tool surface, and reports are identical across providers.

### Anthropic (recommended for production)

Best vision quality, prompt caching across runs, adaptive thinking.

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-7   # or claude-sonnet-4-6, claude-haiku-4-5
ANTHROPIC_EFFORT=high             # low | medium | high | max
```

### OpenAI

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

### Local models via Ollama (free, no API key)

Install [Ollama](https://ollama.com), pull a vision-capable model with tool use, then point us at its OpenAI-compatible endpoint:

```bash
ollama pull qwen2.5vl
ollama serve   # exposes http://localhost:11434
```

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=qwen2.5vl
```

The same shape works for **LM Studio**, **vLLM**, **llama.cpp server**, **OpenRouter**, **Together**, **Groq**, etc. — just change `OPENAI_BASE_URL` and `OPENAI_MODEL`.

> **Note on local models:** UI testing requires both vision and reliable tool use. Most small open models struggle with this. As of late 2025, the best zero-cost path is `qwen2.5vl` (7B+) or `llama3.2-vision` for non-tool-use specs. Cloud Claude/GPT remains the most reliable for production CI.

## How it works

1. **Spec parser** reads the markdown file and extracts steps + expectations.
2. **Browser session** boots a Chromium instance via Playwright.
3. **Agent loop** sends each turn to the configured LLM. The agent sees the current screenshot and decides which tool to call:
   - `navigate(url)`
   - `click(target, role?)`
   - `fill(target, value)`
   - `press_key(key)`
   - `wait(ms | for_text)`
   - `scroll(direction)`
   - `observe()` — refresh screenshot
   - `finish_test(passed, summary, expectations_checked, failure_reason?)` — verdict
4. **Each tool result** includes a fresh screenshot fed back to the agent so it can verify what just happened.
5. **Run record** is persisted to SQLite; the **HTML report** is written to `reports/<run_id>/index.html` with all screenshots inlined.

## Project layout

```text
src/
├── server.ts                # Express server + dashboard
├── cli.ts                   # Command-line runner
├── config.ts                # Env-backed configuration
├── types.ts                 # Shared types
├── specs/loader.ts          # Markdown spec parser
├── runner/
│   ├── browser.ts           # Playwright session wrapper
│   └── orchestrator.ts      # Coordinates one run end-to-end
├── agent/
│   ├── prompts.ts           # System + user prompt builders
│   ├── tools.ts             # Browser tool definitions + dispatcher
│   ├── executor.ts          # Provider dispatcher (LLM-agnostic entry point)
│   └── providers/
│       ├── types.ts         # LLMProvider interface
│       ├── anthropic.ts     # Native Claude provider (vision + caching + thinking)
│       └── openai-compat.ts # OpenAI / Ollama / LM Studio / vLLM / ...
├── reports/generator.ts     # HTML + JSON report generator
├── storage/db.ts            # SQLite persistence
└── triggers/github.ts       # GitHub webhook handler + signature verify

specs/                       # Plain-English test specs (markdown)
data/                        # Runtime state: SQLite DB + screenshots
reports/                     # Generated HTML reports
```

## Configuration reference

| Env var                  | Default                          | Description                                       |
| ------------------------ | -------------------------------- | ------------------------------------------------- |
| `LLM_PROVIDER`           | `anthropic`                      | `anthropic` or `openai`                           |
| `ANTHROPIC_API_KEY`      | (required if anthropic)          | Claude API key                                    |
| `ANTHROPIC_MODEL`        | `claude-opus-4-7`                | Claude model ID                                   |
| `ANTHROPIC_EFFORT`       | `high`                           | `low` / `medium` / `high` / `max`                 |
| `OPENAI_API_KEY`         | (required if openai cloud)       | OpenAI key (or any string for local servers)      |
| `OPENAI_BASE_URL`        | `https://api.openai.com/v1`      | OpenAI-compatible endpoint                        |
| `OPENAI_MODEL`           | `gpt-4o`                         | Model name on the chosen endpoint                 |
| `PORT`                   | `3000`                           | Server port                                       |
| `HOST`                   | `0.0.0.0`                        | Server bind host                                  |
| `GITHUB_WEBHOOK_SECRET`  | (empty)                          | If set, webhooks must include valid HMAC sig      |
| `TARGET_BASE_URL`        | (empty)                          | Default base URL for specs without one            |
| `HEADLESS`               | `true`                           | Run browser headless                              |
| `BROWSER_TIMEOUT_MS`     | `30000`                          | Default Playwright timeout                        |
| `MAX_AGENT_STEPS`        | `40`                             | Max agent turns before forced abort               |
| `DATA_DIR`               | `./data`                         | DB + screenshots                                  |
| `REPORTS_DIR`            | `./reports`                      | Generated reports                                 |
| `SPECS_DIR`              | `./specs`                        | Test specs                                        |

## Tips for good specs

- **Be specific in expectations.** "The page should look right" is checkable but vague — "The header should show 'Welcome, Alice'" is better.
- **Use the language a human would use.** "Click the Sign in button" beats "Click button.btn-primary".
- **Keep tests focused.** One flow per spec. Add a second spec for an alternative path.
- **Tag for routing.** `tags: [smoke]` runs on every push to main; `tags: [pr]` runs on every PR.

## Costs

Each test step costs ~1 LLM API call (input: prompt + screenshot ≈ 2K tokens, output ≈ 200 tokens). Approximate cost of a 10-step test by provider:

| Provider                | Model              | ~Cost per 10-step test |
| ----------------------- | ------------------ | ---------------------- |
| Anthropic               | Opus 4.7           | $0.05 – $0.15          |
| Anthropic               | Sonnet 4.6         | $0.03 – $0.09          |
| Anthropic               | Haiku 4.5          | $0.01 – $0.03          |
| OpenAI                  | GPT-4o             | $0.04 – $0.12          |
| OpenAI                  | GPT-4o-mini        | $0.005 – $0.015        |
| Ollama (local)          | qwen2.5vl, llava   | $0 (compute only)      |

Prompt caching on Anthropic further reduces cost on repeated runs.

## License

MIT
