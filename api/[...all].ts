// Vercel Functions catch-all entry. Delegates to our Hono app via the
// Web Fetch API standard handler shape that Vercel Node.js Functions
// support natively (request: Request → Response | Promise<Response>).

import app from "../src/index.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: Request): Promise<Response> {
  return await app.fetch(req);
}
