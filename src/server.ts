import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { closeDatabase } from "./db.js";
import { discoverWorkdayHcm } from "./discovery.js";
import { getDocument, listChanges, searchDocuments } from "./repository.js";
import { fetchWorkdayPage, selectExcerpts } from "./workday.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function requireService(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.headers.authorization;
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const actual = tokenDigest(supplied);
  const expected = tokenDigest(config.VENDOR_KNOWLEDGE_SERVICE_TOKEN);
  if (!supplied || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/healthz", (_req, res) => res.json({ status: "ok", retainedPageBodies: false, mcpEndpoint: false }));
app.use("/internal", requireService);

const searchSchema = z.object({
  query: z.string().min(2).max(500),
  vendor: z.enum(["WORKDAY", "ORACLE", "PEOPLESOFT"]).optional(),
  product: z.string().max(200).optional(),
  module: z.string().max(200).optional(),
  release: z.string().max(100).optional(),
  status: z.enum(["CURRENT", "CHANGED", "RETIRED", "INACCESSIBLE"]).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

app.post("/internal/v1/search", async (req, res, next) => {
  try {
    const input = searchSchema.parse(req.body);
    res.json({ items: await searchDocuments(input) });
  } catch (error) {
    next(error);
  }
});

const guidanceSchema = z.object({
  externalDocumentId: z.string().min(1).max(500),
  query: z.string().min(2).max(500),
  maxExcerpts: z.number().int().min(1).max(3).default(3),
  maxWordsPerExcerpt: z.number().int().min(1).max(75).default(75),
});

app.post("/internal/v1/guidance", async (req, res, next) => {
  try {
    const input = guidanceSchema.parse(req.body);
    const document = await getDocument(input.externalDocumentId);
    if (!document) {
      res.status(404).json({ error: "Vendor reference not found" });
      return;
    }
    const page = await fetchWorkdayPage(String(document.canonicalUrl));
    res.json({
      externalDocumentId: page.externalDocumentId,
      vendor: document.vendor,
      documentTitle: page.documentTitle,
      sectionTitle: page.sectionTitle,
      canonicalUrl: page.canonicalUrl,
      latestObservedRelease: page.latestObservedRelease,
      retrievedAt: new Date().toISOString(),
      contentHash: page.contentHash,
      sourceStatus: document.contentHash === page.contentHash ? document.sourceStatus : "CHANGED",
      accessClassification: document.accessClassification,
      excerpts: selectExcerpts(page.paragraphs, input.query, input.maxExcerpts, input.maxWordsPerExcerpt),
    });
  } catch (error) {
    next(error);
  }
});

const changesSchema = z.object({
  vendor: z.enum(["WORKDAY", "ORACLE", "PEOPLESOFT"]).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

app.post("/internal/v1/changes", async (req, res, next) => {
  try {
    const input = changesSchema.parse(req.body);
    res.json({ items: await listChanges(input) });
  } catch (error) {
    next(error);
  }
});

const discoverySchema = z.object({
  rootUrl: z.string().url().optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
});

app.post("/internal/v1/discover", async (req, res, next) => {
  try {
    res.status(202).json(await discoverWorkdayHcm(discoverySchema.parse(req.body)));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(422).json({ error: "Invalid request", issues: error.issues.map((issue) => issue.message) });
    return;
  }
  const message = error instanceof Error ? error.message : "Internal error";
  res.status(502).json({ error: message.slice(0, 500) });
});

const server = app.listen(config.PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "vendor-knowledge.started", port: config.PORT }));
});

async function shutdown(): Promise<void> {
  server.close();
  await closeDatabase();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
