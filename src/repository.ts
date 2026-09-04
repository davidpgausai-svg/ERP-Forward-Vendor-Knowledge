import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import type { ParsedWorkdayPage } from "./workday.js";

export async function upsertWorkdayPage(page: ParsedWorkdayPage): Promise<boolean> {
  const existing = await pool.query<{ content_hash: string | null }>(
    "SELECT content_hash FROM vendor_documents WHERE external_document_id = $1",
    [page.externalDocumentId],
  );
  const changed = Boolean(existing.rows[0]?.content_hash && existing.rows[0].content_hash !== page.contentHash);
  await pool.query(
    `INSERT INTO vendor_documents (
       id, external_document_id, vendor, product, module, document_title,
       section_title, canonical_url, source_type, latest_observed_release,
       source_status, access_classification, retrieval_description, content_hash
     ) VALUES ($1, $2, 'WORKDAY', 'Human Capital Management', $3, $4, $5, $6,
       'ADMIN_GUIDE', $7, 'CURRENT', 'CONFIDENTIAL', $8, $9)
     ON CONFLICT (external_document_id) DO UPDATE SET
       module = EXCLUDED.module,
       document_title = EXCLUDED.document_title,
       section_title = EXCLUDED.section_title,
       canonical_url = EXCLUDED.canonical_url,
       latest_observed_release = COALESCE(EXCLUDED.latest_observed_release, vendor_documents.latest_observed_release),
       previous_content_hash = CASE WHEN vendor_documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         THEN vendor_documents.content_hash ELSE vendor_documents.previous_content_hash END,
       content_hash = EXCLUDED.content_hash,
       source_status = CASE WHEN vendor_documents.content_hash IS NOT NULL
         AND vendor_documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN 'CHANGED' ELSE 'CURRENT' END,
       changed_at = CASE WHEN vendor_documents.content_hash IS NOT NULL
         AND vendor_documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN now() ELSE vendor_documents.changed_at END,
       retrieval_description = CASE WHEN vendor_documents.description_status = 'VERIFIED'
         THEN vendor_documents.retrieval_description ELSE EXCLUDED.retrieval_description END,
       last_seen_at = now()`,
    [
      randomUUID(), page.externalDocumentId, page.module, page.documentTitle,
      page.sectionTitle, page.canonicalUrl, page.latestObservedRelease ?? null,
      page.retrievalDescription, page.contentHash,
    ],
  );
  return changed;
}

export async function searchDocuments(input: {
  query: string;
  vendor?: string;
  product?: string;
  module?: string;
  release?: string;
  status?: string;
  limit: number;
}) {
  const result = await pool.query(
    `SELECT external_document_id AS "externalDocumentId", vendor, product, module,
       document_title AS "documentTitle", section_title AS "sectionTitle",
       canonical_url AS "canonicalUrl", source_type AS "sourceType",
       baseline_release AS "baselineRelease", latest_observed_release AS "latestObservedRelease",
       source_status AS "sourceStatus", access_classification AS "accessClassification",
       retrieval_description AS "retrievalDescription", description_status AS "descriptionStatus",
       content_hash AS "contentHash", last_seen_at AS "lastSeenAt",
       ts_rank(to_tsvector('english', document_title || ' ' || section_title || ' ' || module || ' ' || retrieval_description),
         websearch_to_tsquery('english', $1)) AS relevance
     FROM vendor_documents
     WHERE to_tsvector('english', document_title || ' ' || section_title || ' ' || module || ' ' || retrieval_description)
       @@ websearch_to_tsquery('english', $1)
       AND ($2::text IS NULL OR vendor = $2)
       AND ($3::text IS NULL OR product = $3)
       AND ($4::text IS NULL OR module ILIKE '%' || $4 || '%')
       AND ($5::text IS NULL OR baseline_release = $5 OR latest_observed_release = $5)
       AND ($6::text IS NULL OR source_status = $6)
     ORDER BY relevance DESC, document_title, section_title
     LIMIT $7`,
    [input.query, input.vendor ?? null, input.product ?? null, input.module ?? null, input.release ?? null, input.status ?? null, input.limit],
  );
  return result.rows;
}

export async function getDocument(externalDocumentId: string) {
  const result = await pool.query(
    `SELECT external_document_id AS "externalDocumentId", vendor,
       document_title AS "documentTitle", section_title AS "sectionTitle",
       canonical_url AS "canonicalUrl", latest_observed_release AS "latestObservedRelease",
       source_status AS "sourceStatus", access_classification AS "accessClassification",
       content_hash AS "contentHash"
     FROM vendor_documents WHERE external_document_id = $1`,
    [externalDocumentId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

export async function listChanges(input: { vendor?: string; since?: string; limit: number }) {
  const result = await pool.query(
    `SELECT external_document_id AS "externalDocumentId", vendor,
       document_title AS "documentTitle", section_title AS "sectionTitle",
       canonical_url AS "canonicalUrl", previous_content_hash AS "previousContentHash",
       content_hash AS "contentHash", source_status AS "sourceStatus",
       changed_at AS "changedAt"
     FROM vendor_documents
     WHERE source_status IN ('CHANGED', 'RETIRED', 'INACCESSIBLE')
       AND ($1::text IS NULL OR vendor = $1)
       AND ($2::timestamptz IS NULL OR changed_at >= $2)
     ORDER BY changed_at DESC NULLS LAST LIMIT $3`,
    [input.vendor ?? null, input.since ?? null, input.limit],
  );
  return result.rows;
}

export async function startDiscoveryRun(rootUrl: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO discovery_runs (id, vendor, root_url, status) VALUES ($1, 'WORKDAY', $2, 'RUNNING')",
    [id, rootUrl],
  );
  return id;
}

export async function finishDiscoveryRun(id: string, pages: number, changed: number, error?: string) {
  await pool.query(
    `UPDATE discovery_runs SET status = $2, pages_discovered = $3, pages_changed = $4,
       completed_at = now(), error_summary = $5 WHERE id = $1`,
    [id, error ? "FAILED" : "COMPLETE", pages, changed, error?.slice(0, 500) ?? null],
  );
}
