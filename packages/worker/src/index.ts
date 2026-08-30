import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth";
import { filesRouter } from "./routes/files";
import { downloadRouter } from "./routes/download";
import { multipartRouter } from "./routes/multipart";
import { meRouter } from "./routes/me";
import { sharesRouter } from "./routes/shares";
import type { Env, UserContext } from "./types";

export { DownloadTokenDO } from "./durable-objects/DownloadTokenDO";

type Variables = { user: UserContext };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "CF-Access-Jwt-Assertion"],
  })
);

app.use("/api/*", authMiddleware);

app.route("/api", meRouter);
app.route("/api", filesRouter);
app.route("/api", downloadRouter);
app.route("/api", multipartRouter);
app.route("/api", sharesRouter);

app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 404) {
    return c.env.ASSETS.fetch(new Request(new URL("/index.html", c.req.url).toString()));
  }
  return res;
});

export default app;
