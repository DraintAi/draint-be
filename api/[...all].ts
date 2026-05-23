// Vercel Functions entry. Uses hono/vercel `handle()` with named HTTP-method
// exports — the only pattern that Vercel recognizes as Web Fetch API style.
//
// Default-export `async (req: Request) => Response` is interpreted by Vercel
// as a Node-style (req, res) handler with a discarded return value, which
// causes Hono to receive an IncomingMessage instead of a Web Request and
// crash on `this.raw.headers.get`.
//
// Named exports via hono/vercel.handle() do the IncomingMessage → Request
// adaptation correctly.

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
