import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth";
import { filesRouter } from "./routes/files";
import { downloadRouter } from "./routes/download";
import { multipartRouter } from "./routes/multipart";
import type { Env } from "./types";

export { DownloadTokenDO } from "./durable-objects/DownloadTokenDO";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "CF-Access-Jwt-Assertion"],
  })
);

app.use("/api/*", authMiddleware);

app.route("/api", filesRouter);
app.route("/api", downloadRouter);
app.route("/api", multipartRouter);

app.all("*", (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
