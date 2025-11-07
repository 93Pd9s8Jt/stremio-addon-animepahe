import alchemy from "alchemy";
import { Worker } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";

const app = await alchemy("animepahe", {
  stateStore: (scope) => new CloudflareStateStore(scope, { forceUpdate: true }),
});

await Worker("worker", {
  name: "stremio-animepahe",
  entrypoint: "./src/worker.ts",
  compatibility: "node",
});

await app.finalize();
