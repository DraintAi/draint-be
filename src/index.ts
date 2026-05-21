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
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "https://draint.vercel.app"],
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
