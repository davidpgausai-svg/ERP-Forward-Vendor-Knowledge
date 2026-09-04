import { config } from "./config.js";
import { finishDiscoveryRun, startDiscoveryRun, upsertWorkdayPage } from "./repository.js";
import { fetchWorkdayPage } from "./workday.js";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function discoverWorkdayHcm(input: { rootUrl?: string; limit?: number } = {}) {
  const rootUrl = input.rootUrl ?? config.WORKDAY_HCM_ROOT_URL;
  const limit = Math.min(input.limit ?? config.DISCOVERY_PAGE_LIMIT, 10_000);
  const runId = await startDiscoveryRun(rootUrl);
  const queue = [rootUrl];
  const seen = new Set<string>();
  let changed = 0;
  try {
    while (queue.length && seen.size < limit) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const page = await fetchWorkdayPage(url);
      if (await upsertWorkdayPage(page)) changed += 1;
      for (const link of page.links) if (!seen.has(link)) queue.push(link);
      if (queue.length && seen.size < limit) await wait(config.DISCOVERY_DELAY_MS);
    }
    await finishDiscoveryRun(runId, seen.size, changed);
    return { runId, pagesDiscovered: seen.size, pagesChanged: changed, queuedRemaining: queue.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown discovery failure";
    await finishDiscoveryRun(runId, seen.size, changed, message);
    throw error;
  }
}
