// Vercel Functions catch-all entry. All requests to /api/* on the deployed
// drain't backend route through this single function, which delegates to
// our Hono app for internal routing.
//
// Local dev still uses `bun run dev` → src/index.ts directly.

import { handle } from "hono/vercel";
import app from "../src/index";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
