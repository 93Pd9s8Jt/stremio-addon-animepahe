import { createHandler } from "stremio-rewired";
import { AnimePaheProvider } from "./providers/animepahe.js";

const apProvider = new AnimePaheProvider();

export function createAddonHandler(proxyBase: string) {
  return createHandler({
    manifest: {
      id: "org.stremio.animepahe",
      version: "0.1.0",
      name: "AnimePahe",
      catalogs: [
        {
          id: "animepahe",
          type: "series",
          name: "AnimePahe",
          extra: [
            {
              name: "search",
              isRequired: true,
            },
          ],
        },
      ],
      idPrefixes: ["ap", "sc"],
      description:
        "Source content and catalogs from AnimePahe",
      resources: ["stream", "catalog", "meta"],
      types: ["series", "movie"],
    },
    onCatalogRequest: async (type, id, extra) => {
      if (id === "animepahe") {
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
