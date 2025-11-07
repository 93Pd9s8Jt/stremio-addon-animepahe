import z from "zod";
import * as m3u8Parser from "m3u8-parser";
import type { CatalogItem, Stream } from "stremio-rewired";

import type { Provider } from "./interface.js";

const BASE_CDN_URL = "https://cdn.streamingcommunityz.ch";

export class StreamingCommunityProvider implements Provider {
  async search(title: string) {
    if (!title) return [];

    const homeResponse = await fetch("https://streamingcommunityz.ch/");

    const xsrfToken = this.getXsrfToken(homeResponse);
    const sessionCookie = this.getSessionCookie(homeResponse);
    const inertiaVersion = await this.getInertiaVersion(homeResponse);

    const cookieToSend = `XSRF-TOKEN=${xsrfToken}; streamingcommunity_session=${sessionCookie};`;

    const response = await fetch(
      `https://streamingcommunityz.ch/it/search?q=${encodeURIComponent(title)}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-xsrf-token": xsrfToken,
          Cookie: cookieToSend,
          "X-Requested-With": "XMLHttpRequest",
          "X-Inertia": "true",
          "X-Inertia-Version": inertiaVersion,
        },
      }
    );

    const json = await response.json().catch((error) => {
      console.error("Search returned invalid JSON", error);

      return null;
    });

    if (!json) return [];

    const schema = z.object({
      props: z.object({
        titles: z.array(
          z.object({
            id: z.number(),
            slug: z.string(),
            name: z.string(),
            type: z.string(),
            images: z.array(
              z.object({
                type: z.string(),
                filename: z.string(),
              })
            ),
          })
        ),
      }),
    });

    try {
      const data = schema.parse(json);

      return data.props.titles.map((record: any) => {
        const posterImage = record.images.find(
          (image: any) => image.type === "poster"
        );

        return {
          title: record.name,
          id: `sc${record.id}-${record.slug}`,
          imageUrl: posterImage
            ? `${BASE_CDN_URL}/images/${posterImage.filename}`
            : undefined,
        };
      });
    } catch (error) {
      console.error("Search returned invalid data:", error);
      return [];
    }
  }

  async getStreams(id: string): Promise<Array<Stream>> {
    const numericId = extractNumericId(id);

    const response = await fetch(
      `https://streamingcommunityz.ch/it/iframe/${numericId}`
    );

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch StreamingCommunity response, status: ${response.status}`
      );
    }

    const html = await response.text();

    const embedUrl = extractVixcloudUrl(html);

    if (!embedUrl) {
      throw new Error("Vixcloud embed URL not found");
    }

    const vixResponse = await fetch(embedUrl);

    if (vixResponse.status !== 200) {
      throw new Error(
        `Failed to fetch Vixcloud response, status: ${vixResponse.status}`
      );
    }

    const vixHtml = await vixResponse.text();

    const masterPlaylist = getMasterPlaylistFromVixResponse(vixHtml);

    const { url, params } = masterPlaylist;

    const paramString = Object.entries(params)
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      )
      .join("&");

    const extraParams = "h=1&scz=1&lang=it";
    const playlistUrl = `${url}?${paramString}&${extraParams}`;

    const playlistText = await fetch(playlistUrl).then((response) =>
      response.text()
    );

    const streamUrlRaw = extractM3u8UrlFromPlaylist(playlistText);

    const [streamUrlBase, streamUrlParams] = streamUrlRaw.split("?");

    const streamUrl = `${streamUrlBase}.m3u8?${streamUrlParams}`;

    return [
      {
        title: "Stream",
        url: streamUrl,
        behaviorHints: {
          notWebReady: true,
        },
      },
    ];
  }

  async getMeta(id: string): Promise<CatalogItem> {
    // Extract id and slug from format like "8451-poirot"
    const idPart = (id && typeof id === "string" && id.split("--")[0]) || "";
    const [numericId, ...slugParts] = idPart.split("-");
    const slug = slugParts.join("-");

    if (!numericId || !slug) {
      throw new Error("Invalid ID format");
    }

    const titleSlug = `${numericId}-${slug}`;

    // Get XSRF token and session cookie
    const homeResponse = await fetch("https://streamingcommunityz.ch/");
    const xsrfToken = this.getXsrfToken(homeResponse);
    const sessionCookie = this.getSessionCookie(homeResponse);
    const inertiaVersion = await this.getInertiaVersion(homeResponse);

    const cookieToSend = `XSRF-TOKEN=${xsrfToken}; streamingcommunity_session=${sessionCookie};`;

    const response = await fetch(
      `https://streamingcommunityz.ch/it/titles/${titleSlug}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-xsrf-token": xsrfToken,
          Cookie: cookieToSend,
          "X-Requested-With": "XMLHttpRequest",
          "X-Inertia": "true",
          "X-Inertia-Version": inertiaVersion,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch title metadata, status: ${response.status}`
      );
    }

    const json = await response.json().catch((error) => {
      console.error("Meta request returned invalid JSON", error);
      throw new Error("Invalid JSON response");
    });

    const titleSchema = z.object({
      id: z.number(),
      name: z.string(),
      slug: z.string(),
      plot: z.string().nullable(),
      type: z.string(),
      release_date: z.string().nullable(),
      last_air_date: z.string().nullable(),
      score: z.string().nullable(),
      images: z.array(
        z.object({
          type: z.string(),
          filename: z.string(),
        })
      ),
      seasons: z
        .array(
          z.object({
            id: z.number(),
            number: z.number(),
            name: z.string().nullable(),
            plot: z.string().nullable(),
            release_date: z.string().nullable(),
            episodes_count: z.number(),
            episodes: z
              .array(
                z.object({
                  id: z.number(),
                  number: z.string(),
                  name: z.string().nullable(),
                  plot: z.string().nullable(),
                  release_date: z.string().nullable(),
                })
              )
              .optional(),
          })
        )
        .optional(),
    });

    const metaSchema = z.object({
      props: z.object({
        title: titleSchema,
      }),
    });

    try {
      const data = metaSchema.parse(json);
      const title = data.props.title;

      const posterImage = title.images.find((image: any) => image.type === "poster");
      const backgroundImage = title.images.find(
        (image: any) => image.type === "background"
      );

      const baseMeta: CatalogItem = {
        id: `sc${title.id}-${title.slug}`,
        name: title.name,
        type: title.type === "tv" ? "series" : "movie",
        poster: posterImage
          ? `${BASE_CDN_URL}/images/${posterImage.filename}`
          : undefined,
        background: backgroundImage
          ? `${BASE_CDN_URL}/images/${backgroundImage.filename}`
          : undefined,
        description: title.plot || undefined,
      };

      // For series, add videos (episodes)
      if (title.type === "tv" && title.seasons) {
        const videos: Array<{
          id: string;
          title: string;
          released: string;
          episode: number;
          season: number;
        }> = [];

        for (const season of title.seasons) {
          // If episodes are included in the response, use them
          if (season.episodes && season.episodes.length > 0) {
            for (const episode of season.episodes) {
              const releaseDate = episode.release_date
                ? new Date(episode.release_date).toISOString()
                : title.release_date
                ? new Date(title.release_date).toISOString()
                : new Date().toISOString();

              videos.push({
                id: `sc${title.id}-${title.slug}--${season.number}-${episode.number}`,
                title: episode.name || `Episodio ${episode.number}`,
                released: releaseDate,
                episode: Number.parseInt(episode.number) || 0,
                season: season.number,
              });
            }
          } else {
            // If episodes are not included, create placeholder entries based on episodes_count
            const releaseDate = season.release_date
              ? new Date(season.release_date).toISOString()
              : title.release_date
              ? new Date(title.release_date).toISOString()
              : new Date().toISOString();

            for (let i = 1; i <= season.episodes_count; i++) {
              videos.push({
                id: `sc${title.id}-${title.slug}--${season.number}-${String(
                  i
                )}`,
                title: `Episodio ${i}`,
                released: releaseDate,
                episode: i,
                season: season.number,
              });
            }
          }
        }

        return {
          ...baseMeta,
          videos,
        };
      }

      return baseMeta;
    } catch (error) {
      console.error("Meta request returned invalid data:", error);
      throw new Error("Failed to parse title metadata");
    }
  }

  private getXsrfToken(response: Response) {
    const cookies = response.headers.get("Set-Cookie");

    const xsrfToken = cookies?.match(/XSRF-TOKEN=([^;]+)/)?.[1];

    if (!xsrfToken) {
      throw new Error("XSRF token not found");
    }

    return decodeURIComponent(xsrfToken);
  }

  private getSessionCookie(response: Response) {
    const cookies = response.headers.get("Set-Cookie");

    const sessionCookie = cookies?.match(
      /streamingcommunity_session=([^;]+)/
    )?.[1];

    if (!sessionCookie) {
      throw new Error("Session cookie not found");
    }

    return decodeURIComponent(sessionCookie);
  }

  private async getInertiaVersion(response: Response) {
    const html = await response.text();

    const match = html.match(
      /<div[^>]*id=["']app["'][^>]*data-page=["']([^"']+)["'][^>]*>/i
    );

    const rawDataPage = match?.[1];

    if (!rawDataPage) {
      throw new Error("Inertia data-page not found");
    }

    const decoded = rawDataPage
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");

    try {
      const page = JSON.parse(decoded) as { version?: string };
      if (!page.version) {
        throw new Error("Inertia version missing");
      }
      return page.version;
    } catch (err) {
      throw new Error("Invalid Inertia data-page JSON");
    }
  }
}

function extractNumericId(id: string) {
  const idPart = (id && typeof id === "string" && id.split("--")[0]) || "";
  const numeric = (idPart && idPart.split("-")[0]) || "";
  return numeric;
}

function extractVixcloudUrl(htmlText: string) {
  const regex = /https:\/\/vixcloud\.co\/embed\/[^^\s"'<>]+/g;
  const matches = htmlText.match(regex);

  const url = matches?.[0];

  if (!url) {
    return null;
  }

  return url.replaceAll("&amp;", "&");
}

function getMasterPlaylistFromVixResponse(html: string) {
  const regex =
    /window\.masterPlaylist\s*=\s*\{\s*params:\s*\{\s*'token':\s*'([^']*)',\s*'expires':\s*'([^']*)',\s*'asn':\s*'([^']*)',\s*\},\s*url:\s*'([^']*)',\s*\}/;

  const match = html.match(regex);

  if (!match) {
    console.error(
      "Master playlist not found:",
      html.indexOf("window.masterPlaylist")
    );

    throw new Error("Master playlist not found");
  }

  const [token, expires, asn, url] = match.slice(1);

  return {
    url,
    params: {
      token,
      expires,
      asn,
    },
  };
}

function extractM3u8UrlFromPlaylist(playlistText: string) {
  const parser = new m3u8Parser.Parser();

  parser.push(playlistText);
  parser.end();

  const manifest = parser.manifest;

  const playlists = manifest.playlists || [];

  const playlist = playlists[0];

  if (!playlist) {
    throw new Error("Playlist not found");
  }

  return playlist.uri;
}
