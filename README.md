# ERP Forward Vendor Knowledge Connector

Internal, metadata-only vendor documentation connector for ERP Forward. This
service is not an MCP server and is not intended for direct user access. ERP
Forward remains the only MCP connection configured in Claude Desktop.

The pilot discovers Workday HCM Administrator Guide metadata, stores hashes and
original retrieval descriptions, and retrieves short live excerpts on demand.
It never persists vendor page bodies or excerpts.

## Local setup

1. Create a PostgreSQL database. `pnpm start` applies the idempotent metadata
   migration automatically before starting the service.
2. Copy `.env.example` values into the runtime secret/environment manager.
3. Run `pnpm install`, `pnpm build`, then `pnpm start`.
4. Configure ERP Forward with the same service token, this service's internal
   HTTPS URL, and `VENDOR_KNOWLEDGE_ENABLED=true`.

## Internal routes

- `POST /internal/v1/discover` — bounded Workday HCM metadata discovery.
- `POST /internal/v1/search` — metadata and retrieval-description search.
- `POST /internal/v1/guidance` — transient live excerpts, maximum 75 words.
- `POST /internal/v1/changes` — changed, retired, or inaccessible references.

All internal routes require the service bearer token. `/healthz` contains no
vendor content and reports that this is not an MCP endpoint.
