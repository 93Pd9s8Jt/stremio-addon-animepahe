import { createHandler } from "stremio-rewired";
import { AnimePaheProvider } from "./providers/animepahe.js";

const apProvider = new AnimePaheProvider();

export function createAddonHandler(proxyBase: string) {
  return createHandler<{
    stremioAddonsConfig: {
      issuer: string;
      signature: string;
    };
  }>({
    manifest: {
      id: "org.stremio.animepahe",
      version: "0.1.2",
      name: "AnimePahe",
      catalogs: [
        {
          id: "animepahe",
          type: "series",
          name: "AnimePahe",
          extra: [
            {
              name: "search",
              isRequired: false,
            },
          ],
        },

      ],
      idPrefixes: ["ap"],
      description:
        "Source content and catalogs from AnimePahe",
      resources: ["stream", "catalog", "meta"],
      types: ["series", "movie"],
      addonCatalogs: [{
        type: "series",
        id: "animepahe-latest",
        name: "Latest Anime"
      }],
      stremioAddonsConfig: {
        issuer: "https://stremio-addons.net",
        signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..VLpw1nEAEBzw_J92by3_hQ.1M_YRbaFGgASQwgSW1AtqFxdX0gF2p_wdzBEmG0qyA_ZTaAABpw2YhNuOtKDW6iiv-2yWFq1b6TMcMfAwhYncjTOmgmoRIouIKyHon2HdgIohGqu8EW7uE-KE58eKTTs.X57yNKcrTm898j68au6fSg"
      }
    },
    onCatalogRequest: async (type, id, extra) => {
      if (id === "animepahe") {
        if (extra?.search) {
          const records = await apProvider.search(extra?.search || "", proxyBase);
          return {
            metas: records.map((record: any) => ({
              id: record.id,
              type: "series",
              name: record.title,
              poster: record.imageUrl,
            })),
          };
        }
        else {
          // catalog for latest
          const records = await apProvider.getLatest(proxyBase);
          return {
            metas: records.map((record: any) => ({
              id: record.id,
              type: "series",
              name: record.title,
              poster: record.imageUrl,
            })),
          };
        }
      }

      return { metas: [] };
    },
    onMetaRequest: async (type, id) => {
      if (id.startsWith("ap")) {
        const idWithoutPrefix = id.replace(/^ap/, "");
        const meta = await apProvider.getMeta(idWithoutPrefix, proxyBase);
        return { meta };
      }

      return { meta: undefined as any };
    },
    onStreamRequest: async (type, id) => {
      if (id.startsWith("ap")) {
        const idWithoutPrefix = id.replace(/^ap/, "");

        const streams = await apProvider.getStreams(idWithoutPrefix);

        const proxiedStreams = streams.map((stream) => ({
          ...stream,
          url: `${proxyBase}${encodeURIComponent(stream.url)}`,
        }));

        return {
          streams: proxiedStreams,
        };
      }

      return {
        streams: [],
      };
    },
  });
}
