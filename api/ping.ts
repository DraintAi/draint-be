// Diagnostic: minimal Vercel Function. Uses named GET export per Vercel's
// expected Web Fetch API pattern.

export const config = {
  runtime: "nodejs",
};

export function GET(_req: Request): Response {
  return new Response(
    JSON.stringify({ ping: "pong", at: new Date().toISOString() }),
    { headers: { "content-type": "application/json" } },
  );
}
