import * as repo from "@lockwatch/db";
import { createServer } from "node:http";
import { loadConfig, log } from "./config";
import { runIndexer } from "./indexer";
import { runRadar } from "./radar";
import { runAlerts, runTelegramPolling, channelsFrom, keeperNotifier } from "./alerts";
import { runKeeper } from "./keeper";

/** Single Railway service: indexer + radar + alerts + Telegram + keeper. Health on $PORT/health. */
async function main() {
  const cfg = loadConfig();
  const db = await repo.connect();
  const ac = new AbortController();
  process.on("SIGTERM", () => ac.abort());
  const tasks: Promise<unknown>[] = [runIndexer(db, cfg, ac.signal), runRadar(db, cfg, ac.signal), runAlerts(db, cfg, ac.signal)];
  if (cfg.telegramToken && process.env.TELEGRAM_MODE !== "webhook") tasks.push(runTelegramPolling(db, cfg, ac.signal));
  if (cfg.vault && cfg.keeperKey) tasks.push(runKeeper(db, cfg, keeperNotifier(db, channelsFrom(cfg), cfg), ac.signal));
  else log("worker", "keeper disabled (set LOCKWATCH_VAULT and KEEPER_PRIVATE_KEY)");
  createServer(async (req, res) => {
    if (req.url === "/health") {
      const snap = await repo.latestSnapshot(db, cfg.chainId).catch(() => undefined);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, chainId: cfg.chainId, lastSnapshot: snap?.ts ?? null }));
    } else res.writeHead(404).end();
  }).listen(Number(process.env.PORT ?? 8080));
  log("worker", "started", { chainId: cfg.chainId, keeper: !!(cfg.vault && cfg.keeperKey), telegram: !!cfg.telegramToken, email: !!cfg.resendKey });
  await Promise.all(tasks);
}
main();
