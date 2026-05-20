import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) =>
  c.json({
    status: "ok",
    service: "draint-be",
    timestamp: new Date().toISOString(),
  }),
);
