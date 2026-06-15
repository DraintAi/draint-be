// Vercel Functions entry. A single function serves the whole Hono app; a
// vercel.json rewrite ("/(.*)" -> "/api") funnels every path (at any depth)
// here. This replaces the previous api/[...all].ts catch-all, which only
// matched ONE path segment on Vercel — so /api/agent/incidents, /api/rescue/*
// (2+ segments) returned a platform 404 and never reached Hono.
//
// hono/vercel `handle()` with named HTTP-method exports is the pattern Vercel
// recognizes as Web Fetch style (default-export is treated as Node-style and
// breaks Hono's Request adaptation).

import { handle } from "hono/vercel";
import app from "../src/index.js";

export const config = {
  runtime: "nodejs",
};

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
export const HEAD = handle(app);
