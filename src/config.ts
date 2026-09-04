import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().min(1),
  VENDOR_KNOWLEDGE_SERVICE_TOKEN: z.string().min(32),
  WORKDAY_HCM_ROOT_URL: z.string().url().default(
    "https://doc.workday.com/admin-guide/en-us/human-capital-management/human-capital-management.html",
  ),
  DISCOVERY_PAGE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(100),
  DISCOVERY_DELAY_MS: z.coerce.number().int().min(250).max(60_000).default(1000),
});

export const config = schema.parse(process.env);

export const WORKDAY_HOST = "doc.workday.com";
export const WORKDAY_HCM_PATH = "/admin-guide/en-us/human-capital-management/";

export function assertAllowedWorkdayUrl(value: string): URL {
  const url = new URL(value);
  url.hash = "";
  if (
    url.protocol !== "https:" ||
    url.hostname !== WORKDAY_HOST ||
    !url.pathname.startsWith(WORKDAY_HCM_PATH)
  ) {
    throw new Error("URL is outside the approved Workday HCM documentation boundary");
  }
  return url;
}
