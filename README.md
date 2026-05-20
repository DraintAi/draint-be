# draint-be

> **drain't backend** — AI security agent + classifier API. Part of [DraintAi/draint](https://github.com/DraintAi).

Hono on Bun, deployed on Vercel Functions (Fluid Compute, Node 24 LTS). Powers the drain't AI agent: classifier, monitor, rescue orchestrator, and runtime SDK.

## Run locally

```bash
bun install
cp .env.example .env
# Fill in keys: Venice AI, 1Shot, Etherscan, Upstash
bun run dev
```

Server starts at `http://localhost:3001`.

## API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Service info |
| `/api/health` | GET | Liveness check |
| `/api/classify` | POST | Classify contract address for 7702 delegation drainer risk |

## Layout

```
src/
├── index.ts           # Hono app entry + middleware
├── routes/            # API route handlers
│   ├── health.ts
│   └── classify.ts
├── lib/               # (Day 2+) classifier, Venice AI, viem clients
└── agent/             # (Day 10) reference agent loop
```

## Stack

- **Runtime**: Bun 1.3+ (also runs on Node 24 LTS)
- **HTTP**: Hono 4
- **Validation**: zod 4
- **Web3**: viem 2
- **AI**: Venice AI (OpenAI-compatible)
- **Relayer**: 1Shot Permissionless Relayer
- **Cache**: Upstash Redis

## Deployment

Deploy to Vercel Functions (Fluid Compute). Configure env vars via `vercel env add` or dashboard.

See [PLAN.md](../../PLAN.md) for full architecture + day-by-day schedule.

---

Built for **MetaMask Smart Accounts Kit x 1Shot API Hackathon**, 2026.
