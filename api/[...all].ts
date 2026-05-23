// Vercel Functions catch-all entry. Delegates to our Hono app via the
// Web Fetch API standard.
//
// Edge runtime: Hono's app.fetch is a pure Request → Response handler
// (Web Standard) and runs in Vercel's Edge environment without
// adaptation. Node runtime requires extra wrapping. Edge also gives
// faster cold-start which is nice for the cron + classify hot paths.

import app from "../src/index";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
  return await app.fetch(req);
}
