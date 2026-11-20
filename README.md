# Personal Feed API

The backend of **Personal Feed**, a showcase of a limited, per-visitor daily media feed. A
visitor picks a few tech topics; the API fetches articles, videos and podcast episodes about
them, classifies each as **read**, **watch** or **listen**, composes a feed of at most 10 items
per type, and answers questions about that feed with an AI chat grounded in it.

Built with NestJS 12, SQLite (Drizzle ORM + `sqlite-vec` + FTS5), local sentence embeddings
(transformers.js) and OpenAI for chat answers. The frontend lives in
[`personal-feed-showcase-fe`](https://github.com/Evgen-Oliynik/personal-feed-showcase-fe).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FRONTEND  (personal-feed-showcase-fe)                   │
│        topics live in the browser (localStorage) and travel with requests   │
└─────────────────────────────────────────────────────────────────────────────┘
          │ GET /feed/today?topics=…        │ POST /chat { question, topics, history }
          ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PERSONAL FEED API  (NestJS 12)                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │   Topics    │ │    Feed     │ │    Chat     │ │           AI            ││
│  │ suggestions │ │  composer   │ │  SSE stream │ │ embedder · hybrid rank  ││
│  └─────────────┘ └─────────────┘ └─────────────┘ │ · LLM                   ││
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ └─────────────────────────┘│
│  │   Sources   │ │ Topic pools │ │  Scheduler  │                            │
│  │ (4 sources) │ │ (per topic) │ │ (cron 06:00)│                            │
│  └─────────────┘ └─────────────┘ └─────────────┘                            │
└─────────────────────────────────────────────────────────────────────────────┘
      │                         │                         │
      ▼                         ▼                         ▼
┌───────────────────┐  ┌─────────────────────────┐  ┌───────────────────────┐
│  External sources │  │  SQLite  (data/feed.db) │  │   OpenAI API          │
│  dev.to · Medium  │  │  media items, pools     │  │   chat answers only   │
│  YouTube · iTunes │  │  chunks + vec0 + FTS5   │  │   (gpt-5.4-mini)      │
└───────────────────┘  └─────────────────────────┘  └───────────────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  Local embedding model  │
                    │  bge-small-en-v1.5      │
                    │  (data/models, no key)  │
                    └─────────────────────────┘
```

The server keeps **no per-visitor state**: no accounts, sessions or cookies. A topic is
fetched from the sources at most once a day and shared by every visitor who follows it.

## Data Flow

### Feed composition — `GET /feed/today?topics=react,rust`

```
┌──────────┐   ┌──────────────────────────────────────────────────────────────┐
│ Frontend │──►│ FeedComposer.compose(topics, today)                          │
└──────────┘   │                                                              │
               │ 1. Normalize topics (lowercase, ^[a-z0-9][a-z0-9 .+#-]*$,    │
               │    1–40 chars, at most 10)                                   │
               │ 2. TopicPool.ensure(topic, today) for each topic:            │
               │    · fetch only sources not yet fetched for (topic, today)   │
               │    · a source that fails is retried by the next request      │
               │    · upsert items by URL; set first_seen_date on insert      │
               │    · embed new items (chunks → vectors + FTS rows)           │
               │ 3. Per type (read / watch / listen), up to 10 items:         │
               │    · FRESH first: first seen today                           │
               │    · then FILL: first seen 1–2 days ago                      │
               │    · round-robin across topics, newest first                 │
               │    · no duplicate URL or normalized title                    │
               │ 4. Same topic list on the same day → same feed               │
               └──────────────────────────────────────────────────────────────┘
```

### Chat — `POST /chat` (Server-Sent Events)

```
┌──────────┐   ┌──────────────────────────────────────────────────────────────┐
│ Frontend │──►│ ChatService.answer(question, topics, history)                │
│ question │   │                                                              │
│ + last 6 │   │ 1. Compose the visitor's feed (≤ 30 items)                   │
│   pairs  │   │ 2. Embed any feed item that still has no chunks              │
└──────────┘   │ 3. Rank every feed item (hybrid):                            │
     ▲         │    · dense: cosine distance of its best chunk to the query   │
     │         │    · lexical: FTS5 bm25() over chunk text                    │
     │         │    · fused by reciprocal rank fusion, k = 60                 │
     │         │ 4. Prompt: ALL feed items, ranked; top 8 with full content   │
     │         │    + history messages + the question                         │
     │         │ 5. OpenAI streams the answer, citing items as [n]            │
     │         └──────────────────────────────────────────────────────────────┘
     │                                  │
     │         ┌────────────────────────┴─────────────────────────────────────┐
     └─────────│  SSE:  event: sources  → every context item with its n       │
               │        event: delta    → { text } chunks of the answer       │
               │        event: done     → end of answer                       │
               │        event: error    → { message }, stream ends            │
               └──────────────────────────────────────────────────────────────┘
```

The chat answers **only from the visitor's feed**. When the feed does not contain the
answer, or the feed is empty, the reply is exactly `This is not in the collected materials`.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `{ "status": "ok" }` |
| `GET` | `/topics/suggestions` | Fixed list of suggested topic names |
| `GET` | `/feed/today?topics=a,b` | Today's feed for the topic list: `{ date, limits, counts, items }`; no topics → empty with `"reason": "no-topics"`; invalid name or more than 10 → `400` |
| `POST` | `/chat` | Body `{ question (1–500), topics, history (≤ 12 × { role, content ≤ 4000 }) }`; responds with `text/event-stream` |

## Sources

| Source | Type | How | Key |
|--------|------|-----|-----|
| **dev.to** | read | RSS `dev.to/feed/tag/<topic>` | — |
| **Medium** | read | RSS `medium.com/feed/tag/<topic>` | — |
| **YouTube** | watch | Data API v3 `search.list` (relevance, English, medium length, Science & Technology, last 7 days) + one batched `videos.list` for full descriptions and durations | `YOUTUBE_API_KEY` |
| **iTunes** | listen | Search API, podcast episodes of genre Technology (id 1318) from the last 90 days | — |

Each source fetches up to 15 items per topic. A source with a missing key is disabled with
one warning at startup. Classification is rule-based: an audio enclosure → listen, a video
enclosure or a YouTube URL → watch, iTunes → listen, otherwise read.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | NestJS 12 (ESM, Express platform) |
| Language | TypeScript 6 |
| Database | SQLite via `better-sqlite3` + Drizzle ORM |
| Vector search | `sqlite-vec` (vec0, cosine) |
| Full-text search | SQLite FTS5 (`bm25()`) |
| Embeddings | `@huggingface/transformers`, `Xenova/bge-small-en-v1.5` (384 dims, local) |
| LLM | OpenAI SDK, `gpt-5.4-mini` (streaming Chat Completions) |
| Validation | Zod via `StandardSchemaValidationPipe` |
| Scheduling | `@nestjs/schedule` + `cron` |
| Feeds | `rss-parser` |
| Tests | Vitest + Supertest |
| Lint / format | oxlint (type-aware) + Prettier |

## Project Structure

```
personal-feed-showcase-be/
├── src/
│   ├── main.ts                 # Bootstrap: CORS for FRONTEND_ORIGIN, PORT
│   ├── app.module.ts
│   ├── config/                 # Zod-validated environment (config.ts)
│   ├── db/                     # Drizzle schema, connection, sqlite-vec loading,
│   │                           # migrations run on startup
│   ├── health/                 # GET /health
│   ├── topics/                 # GET /topics/suggestions, topic-name rule
│   ├── sources/                # dev.to, Medium, YouTube, iTunes adapters,
│   │   │                       # classify(), text normalization
│   │   └── fixtures/           # Deterministic sources for FAKE_EXTERNALS=1
│   ├── feed/
│   │   ├── topic-pool.ts       # Per-topic daily cache, per-source retries
│   │   ├── feed-composer.ts    # Fresh-then-fill, round-robin, dedup
│   │   ├── feed.controller.ts  # GET /feed/today
│   │   └── feed.scheduler.ts   # Cron prewarm of recently requested topics
│   ├── ai/
│   │   ├── embedder.ts         # LocalEmbedder (transformers.js), FakeEmbedder
│   │   ├── chunks.ts           # Items → ≤ 3 chunks of ≤ 800 chars
│   │   ├── item-embeddings.ts  # Chunks, vectors and FTS rows per item
│   │   ├── hybrid-rank.ts      # Dense + BM25, reciprocal rank fusion
│   │   ├── llm.ts              # OpenAiLlm, FakeLlm
│   │   └── chat.service.ts     # Context building, grounding prompt
│   └── chat/                   # POST /chat, SSE streaming, request schema
│
├── drizzle/                    # SQL migrations (0000–0009) and drizzle-kit metadata
├── test/                       # In-process e2e specs (Supertest) and source fixtures
├── data/                       # Runtime only, gitignored: feed.db, models/ cache
└── .env.example
```

## Database

| Table | Purpose |
|-------|---------|
| `media_items` | Every fetched item, unique by URL: type, source, title, summary (≤ 300 chars), content (≤ 2000 chars), author, image, published date, duration, `first_seen_date` |
| `topic_fetches` | `(topic, fetch_date, source)`: which source already answered for a topic that day |
| `topic_items` | `(topic, fetch_date, media_item_id)`: the topic's daily pool |
| `topic_requests` | `(topic, last_requested_date)`: drives the cron prewarm; holds no visitor data |
| `item_chunks` | Up to 3 text chunks per item |
| `chunk_embeddings` | vec0 virtual table, `float[384]`, cosine distance |
| `chunk_fts` | FTS5 virtual table over chunk text (`unicode61`, `#` and `+` kept in terms) |

Migrations in `drizzle/` run automatically on startup.

## Getting Started

Requires **Node.js 24** and npm.

```bash
npm ci
cp .env.example .env      # set OPENAI_API_KEY and YOUTUBE_API_KEY
npm run start:dev         # http://localhost:4000
```

The first feed request for a topic fetches it from the sources (~15 s). The first chat
answer downloads the embedding model (~130 MB, cached in `data/models`) and embeds the
feed, so it takes noticeably longer than later ones.

To run without any API keys or network, set `FAKE_EXTERNALS=1`: sources, the embedder
and the LLM are replaced by deterministic fixtures.

## Scripts

### Development

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start in watch mode |
| `npm run start:debug` | Start in watch mode with the debugger |
| `npm run start` | Start once |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run the compiled build |

### Quality

| Command | Description |
|---------|-------------|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | oxlint, type-aware, over `src/` and `test/` |
| `npm run format` | Prettier over `src/` and `test/` |

### Tests

| Command | Description |
|---------|-------------|
| `npm test` | Unit tests (`src/**/*.spec.ts`) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:cov` | Unit tests with coverage |
| `npm run test:e2e` | In-process e2e (`test/**/*.e2e-spec.ts`) with `FAKE_EXTERNALS=1` and an in-memory database |

No test calls the network or loads the real embedding model.

### Database

| Command | Description |
|---------|-------------|
| `npx drizzle-kit generate` | Generate a migration from schema changes |
| `npx drizzle-kit generate --custom --name <name>` | Empty migration for virtual tables (vec0, FTS5), which drizzle-kit does not model |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP port |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | The only origin allowed by CORS |
| `DATABASE_PATH` | `./data/feed.db` | SQLite file; `:memory:` in tests |
| `FAKE_EXTERNALS` | `false` | `1`/`true` replaces sources, embedder and LLM with fixtures |
| `FEED_CRON` | `0 6 * * *` | Cron for prewarming topics requested in the last 7 days; validated at startup |
| `OPENAI_API_KEY` | — | Required for real chat answers |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Chat model |
| `OPENAI_MAX_TOKENS` | `4096` | `max_completion_tokens`, reasoning included |
| `EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | Local embedding model; the embedder uses CLS pooling and bge's query prefix, so keep a bge model |
| `YOUTUBE_API_KEY` | — | Enables the YouTube source |

"Today" is the server's local date; set `TZ` to control it.

## Notes

- **ESM.** Relative imports end in `.js`, there is no `__dirname` (use `import.meta.dirname`),
  and mocks are `vi.fn()`.
- **YouTube quota.** A `search.list` call costs 100 of the default 10,000 daily units, so a
  topic is fetched once a day for everyone, and only failed sources are retried.
- **Embedding batch size** is 32 texts per model call, a common default that bounds peak
  memory; it has not been benchmarked.
- **Not included:** authentication, rate limiting, deployment configuration.
