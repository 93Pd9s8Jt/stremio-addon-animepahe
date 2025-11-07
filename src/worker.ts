import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAddonHandler } from "./lib/addon.js";

const PROXY_WHITELISTED_DOMAINS = [
  "i\\.animepahe\\.si", // images
  "vault-\\d+\\.uwucdn\\.top" // videos
];

console.log("Starting app");

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = "0"; // animepahe's cdn has an expired ssl certificate

const app = new Hono();


app.use('*', cors())

app.get("/_internal/stream-proxy/img/:url", async (c) => {
  const url = new URL(c.req.param("url"));

  if (!PROXY_WHITELISTED_DOMAINS.some(pattern => new RegExp(pattern).test(url.hostname))) {
    return new Response("Not allowed", { status: 403 });
  }

  const response = await fetch(url.toString(), {
    headers: { // fake browser headers, necessary for the cdns or they will not allow the request
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': url.origin,
    },
  });

  return response;
});

app.get("/_internal/stream-proxy/:url", async (c) => {
  try {
    const url = new URL(c.req.param("url"));

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': url.origin,
      },
    });

    return response;
  } catch (error) {
    console.error("Proxy fetch error:", error);
    return new Response(`Error fetching remote URL: ${(error as Error).message}`, { status: 502 });
  }
});

app.get("*", async (c) => {
  try {
    const url = new URL(c.req.url);

    const proxyBase = `${url.origin}/_internal/stream-proxy/`;
    
    const response = await createAddonHandler(proxyBase)(c.req.raw);

    if (!response) {
      return new Response("Not found", { status: 404 });
    }

    return response;
  } catch (error) {
    console.error("Main route error:", error);
    return new Response(`Internal Server Error: ${(error as Error).message}`, { status: 500 });
  }
});

export default app;
