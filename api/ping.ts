// Diagnostic: minimal Vercel Function. No imports beyond Web API.
// If THIS times out too, the issue is Vercel infra / env vars / bundling,
// not our app code.

export const config = {
  runtime: "nodejs",
};

export default async function handler(_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ ping: "pong", at: new Date().toISOString() }),
    { headers: { "content-type": "application/json" } },
  );
}
