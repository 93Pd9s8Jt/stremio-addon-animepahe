import alchemy from "alchemy";
import { Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";

const app = await alchemy("animepahe", {
  stateStore: (scope) => new CloudflareStateStore(scope),
});

await Worker("worker", {
  name: "stremio-animepahe",
  entrypoint: "./src/worker.ts",
  compatibility: process.env.CI ? undefined : "node",
});

await app.finalize();
