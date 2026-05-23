// Vercel Functions catch-all entry. All requests to /api/* on the deployed
// drain't backend route through this single function, which delegates to
// our Hono app for internal routing.
//
// For pure Vercel Functions (no Next.js), the expected handler shape is
// `export default <(req: Request) => Response>`. Named HTTP-method exports
// (GET/POST/PUT/etc.) are Next.js App Router conventions and DO NOT work
// in raw Vercel Functions — they cause FUNCTION_INVOCATION_FAILED.
//
// Local dev still uses `bun run dev` → src/index.ts directly.

import app from "../src/index";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: Request): Promise<Response> {
  return app.fetch(req);
}
