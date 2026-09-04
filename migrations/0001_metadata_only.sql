CREATE TABLE IF NOT EXISTS vendor_documents (
  id uuid PRIMARY KEY,
  external_document_id text NOT NULL UNIQUE,
  vendor text NOT NULL,
  product text NOT NULL,
  module text NOT NULL,
  document_title text NOT NULL,
  section_title text NOT NULL,
  canonical_url text NOT NULL UNIQUE,
  source_type text NOT NULL,
  baseline_release text NOT NULL DEFAULT 'UNDECIDED',
  latest_observed_release text,
  source_status text NOT NULL DEFAULT 'CURRENT',
  access_classification text NOT NULL DEFAULT 'CONFIDENTIAL',
  retrieval_description text NOT NULL,
  description_status text NOT NULL DEFAULT 'DRAFT',
  content_hash text,
  previous_content_hash text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz,
  CONSTRAINT vendor_documents_status_check
    CHECK (source_status IN ('CURRENT', 'CHANGED', 'RETIRED', 'INACCESSIBLE')),
  CONSTRAINT vendor_documents_description_status_check
    CHECK (description_status IN ('DRAFT', 'VERIFIED'))
);

CREATE INDEX IF NOT EXISTS vendor_documents_search_idx ON vendor_documents USING gin (
  to_tsvector('english', document_title || ' ' || section_title || ' ' || module || ' ' || retrieval_description)
);

CREATE INDEX IF NOT EXISTS vendor_documents_changed_idx
  ON vendor_documents (source_status, changed_at DESC);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id uuid PRIMARY KEY,
  vendor text NOT NULL,
  root_url text NOT NULL,
  status text NOT NULL,
  pages_discovered integer NOT NULL DEFAULT 0,
  pages_changed integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_summary text
);
