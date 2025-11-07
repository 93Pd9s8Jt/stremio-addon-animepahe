import { type ContentType, type Stream } from "stremio-rewired";

export interface Provider {
  getStreams: (id: string) => Promise<Array<Stream>>;
  search: (
    title: string,
    proxyBase: string
  ) => Promise<{ title: string; id: string; imageUrl?: string }[]>;
  getMeta: (
    id: string,
    title: string,
    proxyBase: string
  ) => Promise<{ name: string; id: string; type: ContentType }>;
}
