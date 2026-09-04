import { createHash, randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { assertAllowedWorkdayUrl } from "./config.js";

const USER_AGENT = "ERP-Forward-Vendor-Knowledge-Pilot/0.1";
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_BUDGET_BYTES = 5 * 1024 * 1024;

export interface ParsedWorkdayPage {
  externalDocumentId: string;
  canonicalUrl: string;
  documentTitle: string;
  sectionTitle: string;
  module: string;
  retrievalDescription: string;
  contentHash: string;
  latestObservedRelease?: string;
  links: string[];
  paragraphs: Array<{ heading?: string; text: string }>;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collapseRepeatedText(value: string): string {
  const normalized = normalizeSpace(value);
  const midpoint = normalized.length / 2;
  return Number.isInteger(midpoint) && normalized.slice(0, midpoint) === normalized.slice(midpoint)
    ? normalized.slice(0, midpoint)
    : normalized;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableDocumentId(url: string): string {
  return `workday:${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

function observedRelease(text: string): string | undefined {
  return text.match(/\b20\d{2}R[12]\b/i)?.[0]?.toUpperCase();
}

function inferModule(breadcrumbs: string[], title: string): string {
  const ignored = new Set(["home", "guides", "administrator guide", "human capital management"]);
  return breadcrumbs.find((item) => !ignored.has(item.toLowerCase())) ?? title;
}

function retrievalDescription(
  documentTitle: string,
  sectionTitle: string,
  module: string,
  headings: string[],
): string {
  const topics = headings.filter((heading) => heading !== sectionTitle).slice(0, 8);
  const suffix = topics.length ? ` Related sections include ${topics.join(", ")}.` : "";
  return `Retrieve this Workday Human Capital Management Administrator Guide source when answering implementation, configuration, process-design, dependency, security, or fit-gap questions about ${module}, especially ${sectionTitle}. It belongs to ${documentTitle}.${suffix}`;
}

export async function fetchWorkdayPage(value: string): Promise<ParsedWorkdayPage> {
  const url = assertAllowedWorkdayUrl(value);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Workday returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > PAGE_BUDGET_BYTES) throw new Error("Workday page exceeded the size limit");
  const html = new TextDecoder().decode(bytes);
  const $ = cheerio.load(html);
  $("script, style, nav, footer, button, noscript, svg").remove();
  const contentRoot = $("#maincontent").first().length ? $("#maincontent").first() : $("main").first();

  const canonical = $("link[rel='canonical']").attr("href") ?? url.toString();
  const canonicalUrl = assertAllowedWorkdayUrl(new URL(canonical, url).toString()).toString();
  const documentTitle = collapseRepeatedText($("title").text()).replace(/\s*\|.*$/, "") ||
    "Workday HCM Administrator Guide";
  const sectionTitle = normalizeSpace(contentRoot.find("h1").first().text()) ||
    normalizeSpace($("h1").first().text()) || documentTitle;
  const breadcrumbs = $("[aria-label*='readcrumb'] a, .breadcrumb a")
    .map((_index, element) => normalizeSpace($(element).text()))
    .get()
    .filter(Boolean);
  const headings = contentRoot.find("h1, h2, h3")
    .map((_index, element) => normalizeSpace($(element).text()))
    .get()
    .filter(Boolean);
  const module = inferModule(breadcrumbs, sectionTitle);

  let currentHeading: string | undefined;
  const paragraphs: Array<{ heading?: string; text: string }> = [];
  contentRoot.find("h1, h2, h3, p, li").each((_index, element) => {
    const tag = element.tagName.toLowerCase();
    const text = normalizeSpace($(element).text());
    if (!text) return;
    if (tag.startsWith("h")) currentHeading = text;
    else if (text.length >= 30) paragraphs.push({ ...(currentHeading ? { heading: currentHeading } : {}), text });
  });
  const normalizedContent = [documentTitle, sectionTitle, ...paragraphs.map((item) => `${item.heading ?? ""}\n${item.text}`)].join("\n");
  const links = contentRoot.find("a[href]")
    .map((_index, element) => {
      try {
        return assertAllowedWorkdayUrl(new URL($(element).attr("href")!, url).toString()).toString();
      } catch {
        return null;
      }
    })
    .get()
    .filter((link): link is string => Boolean(link));

  return {
    externalDocumentId: stableDocumentId(canonicalUrl),
    canonicalUrl,
    documentTitle,
    sectionTitle,
    module,
    retrievalDescription: retrievalDescription(documentTitle, sectionTitle, module, headings),
    contentHash: sha256(normalizedContent),
    ...(observedRelease(normalizedContent) ? { latestObservedRelease: observedRelease(normalizedContent) } : {}),
    links: [...new Set(links)],
    paragraphs,
  };
}

export function selectExcerpts(
  paragraphs: ParsedWorkdayPage["paragraphs"],
  query: string,
  maxExcerpts: number,
  maxWords: number,
): Array<{ heading?: string; text: string }> {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((term) => term.length > 2);
  return paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: terms.reduce((score, term) => score + (paragraph.text.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxExcerpts)
    .map(({ paragraph }) => ({
      ...(paragraph.heading ? { heading: paragraph.heading } : {}),
      text: paragraph.text.split(/\s+/).slice(0, maxWords).join(" "),
    }));
}

export function newRunId(): string {
  return randomUUID();
}
