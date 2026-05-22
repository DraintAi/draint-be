import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agent } from "./routes/agent";
import { classify } from "./routes/classify";
import { health } from "./routes/health";
import { CLASSIFIER_VERSION } from "./lib/classifier";
import { veniceEnabled } from "./lib/classifier/venice";

const app = new Hono();

app.use("*", logger());
// Permissive CORS — drain't backend is a public, read-only-ish classifier.
// Snap sandbox origins, dev tools, and arbitrary AI agents all need to call
// /api/classify. We don't accept credentials, so allow-all is safe.
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: false,
  }),
);

app.get("/", (c) =>
  c.json({
    name: "drain't backend",
    version: "0.0.1",
    tagline: "Wallet drain? Didn't happen.",
    endpoints: [
      "/api/health",
      "/api/classify",
      "/api/agent/tick",
      "/api/agent/watch",
      "/api/agent/incidents",
    ],
    classifier: {
      version: CLASSIFIER_VERSION,
      veniceEnabled,
    },
  }),
);

app.route("/api/health", health);
app.route("/api/classify", classify);
app.route("/api/agent", agent);

export default app;
