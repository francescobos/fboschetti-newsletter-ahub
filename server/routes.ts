import type { Database } from "bun:sqlite";
import { Hono } from "hono";

export default function createRoutes(deps: {
  db: Database;
  slug: string;
  projectRoot: string;
}) {
  const r = new Hono();
  r.get("/stato", (c) => c.json({ slug: deps.slug }));
  return r;
}
