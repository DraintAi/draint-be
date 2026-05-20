import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { classify } from "./routes/classify";
import { health } from "./routes/health";

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
    endpoints: ["/api/health", "/api/classify"],
  }),
);

app.route("/api/health", health);
app.route("/api/classify", classify);

export default app;
