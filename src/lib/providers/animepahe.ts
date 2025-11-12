import z from "zod";
import type { Meta } from "stremio-rewired";
import { parseHTML } from 'linkedom';
import type { Provider } from "./interface.js";
import JsUnpacker from "js-unpacker"; // necessary for one of the animepahe scraping methods

const BASEURL = "https://animepahe.si";

export class AnimePaheProvider implements Provider {
  async search(title: string, proxyBase: string) {
    const response = await fetch(`${BASEURL}/api?m=search&l=8&q=${title}`, {
      method: "GET",
      headers: {
        Cookie: '__ddg1_=;__ddg2_=;',
      },
    });

    const json = await response.json().catch(() => {
      console.error("Search returned invalid JSON");
      return null;
    });

    if (!json) {
      return [];
    }

    const schema = z.object({
      data: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          type: z.string(),
          episodes: z.number(),
          status: z.string(),
          year: z.number(),
          score: z.number(),
          poster: z.string(),
          session: z.string()
        })
      ),
    });

    try {
      const data = schema.parse(json);
      return data.data.map((record) => ({
        title: record.title,
        id: "ap" + record.session,
        imageUrl: proxyUrl(record.poster, proxyBase),
      }));
    } catch (error) {
      console.error("Search returned invalid data:", error);
      return [];
    }
  }

  async getLatest(proxyBase: string) {
    const response = await fetch(`${BASEURL}/api?m=airing&page=1`, {
      headers: {
        Cookie: '__ddg1_=;__ddg2_=;',
      }
    })
    const latestJson = await response.json();
    const latestSchema = z.object({
      data: z.array(
        z.object({
          id: z.number(),
          anime_id: z.number(),
          anime_title: z.string(),
          anime_session: z.string(),
          episode: z.number(),
          episode2: z.number(),
          edition: z.string(),
          fansub: z.string(),
          snapshot: z.string(),
          disc: z.string(),
          session: z.string(),
          filler: z.number(),
          created_at: z.string(),
          completed: z.number()
        })
      )
    })

    const latestParsed = latestSchema.parse(latestJson);
    return latestParsed.data.map((record) => ({
      id: `ap${record.anime_session}`,
      title: record.anime_title,
      imageUrl: proxyUrl(record.snapshot, proxyBase),
    }))

  }

  async getMeta(id: string, proxyBase: string): Promise<Meta> {
    const animeId = id.replace("ap", "").split("|")[0];

    const response = await fetch(`${BASEURL}/anime/${animeId}`, {
      method: "GET",
      headers: {
        Cookie: '__ddg1_=;__ddg2_=;',
      },
    });

    const json = await response.text();

    const { document } = parseHTML(json);
    var description = document.querySelector('.anime-synopsis')?.innerHTML.replace(/<br\s*\/?>/g, "\n").trim();
    var name = document.querySelector('span[style="user-select:text"]')?.textContent?.trim();
    var poster = document.querySelector('img[data-src$=".jpg"]')?.getAttribute('data-src')?.trim();
    var background = "https:" + document.querySelector('div.anime-cover')?.getAttribute('data-src')?.trim();
    const pTags = document.querySelectorAll(".anime-info p");
    const airedTag = Array.from(pTags).find(p =>
      p.textContent.trim().startsWith('Aired:')
    );
    var aired = airedTag?.textContent
      .replace(/\s+/g, ' ')        // normalize whitespace
      .replace('Aired:', '')       // remove the label
      .trim();

    const durationTag = Array.from(pTags).find(p =>
      p.textContent.trim().startsWith('Duration:')
    );
    var duration = durationTag?.textContent
      .replace(/\s+/g, ' ')        // normalize whitespace
      .replace('Duration:', '')       // remove the label
      .trim();

    var externalLink = new URL(document.querySelector(".external-links a")?.getAttribute("href") ?? "", "https://example.com").href // can't use :(
    var genres = Array.from(document.querySelectorAll(".anime-genre li")).map(g => g.textContent.trim())



    poster = proxyUrl(poster ?? "", proxyBase);
    background = proxyUrl(background ?? "", proxyBase);

    const videosData = await fetch(`${BASEURL}/api?m=release&id=${animeId}&sort=episode_dsc`, {
      headers: {
        Cookie: '__ddg1_=;__ddg2_=;',
      }
    });
    const videosJson = await videosData.json();
    const videosSchema = z.object({
      data: z.array(
        z.object({
          id: z.number(),
          anime_id: z.number(),
          episode: z.number(),
          episode2: z.number(),
          edition: z.string(),
          title: z.string(),
          snapshot: z.string(),
          disc: z.string(),
          audio: z.string(),
          duration: z.string(),
          session: z.string(),
          filler: z.number(),
          created_at: z.string(),
        })
      ),
    });
    const videosParsed = videosSchema.parse(videosJson);

    const videos = videosParsed.data.map((video) => ({
      id: `ap${animeId}|${video.session}`,
      title: video.title || `Episode ${video.episode}`,
      released: new Date(video.created_at).toISOString(),
      episode: video.episode,
      season: 0, // otherwise they will be sorted in reverse order
      thumbnail: proxyUrl(video.snapshot, proxyBase),
      available: true,
    }));

    videos.sort((a, b) => a.episode - b.episode);

    return {
      id: `ap${animeId}`,
      name: name ?? "",
      type: "series",
      //logo: "https://raw.githubusercontent.com/93Pd9s8Jt/stremio-addon-animepahe/refs/heads/main/images/apdoesnthavelogotheysaidapistooplaintheysaid.png", // higher quality conversion of the svg
      poster: poster ?? "",
      description: description ?? "",
      background: background ?? "",
      releaseInfo: aired ?? "",
      runtime: duration,
      genres: genres,
      website: externalLink ?? "",
      videos,
    };
  }

  async getStreams(
    id: string
  ): Promise<Array<{ id: string; title: string; url: string }>> {
    const [animeId, animeSession] = id.split("|");
    const res = await fetch(`${BASEURL}/play/${animeId}/${animeSession}`, { headers: { Cookie: '__ddg1_=;__ddg2_=;' } });
    const html = await res.text();
    const { document } = parseHTML(html);

    const downloadLinks = Array.from(document.querySelectorAll('div#pickDownload > a'));
    const buttons = Array.from(document.querySelectorAll('div#resolutionMenu > button'));
    const videos = [];

    const USE_HLS_LINKS = false; // currently doesn't work with true
    // check for fixes at https://github.com/m2k3a/mangayomi-extensions/blob/main/dart/anime/src/en/animepahe/animepahe.dart
    // or https://github.com/yuzono/aniyomi-extensions/blob/master/src/en/animepahe/src/eu/kanade/tachiyomi/animeextension/en/animepahe/KwikExtractor.kt#L58
    // or maybe find a fix yourself

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i]!;
      const audio = btn.getAttribute('data-audio');
      const kwikLink = btn.getAttribute('data-src');
      const quality = btn.getAttribute("data-resolution")
      const paheWinLink = downloadLinks[i]!.getAttribute('href');

      if (USE_HLS_LINKS) {

        // First request to get kwik headers
        const kwikHeadersResponse = await fetch(
          `${paheWinLink}/i`, {
          redirect: 'manual',
          headers: {
            'Referer': 'https://animepahe.com'
          }
        }
        );
        const kwikHeaders = kwikHeadersResponse.headers;

        const kwikLocation = getMapValue(JSON.stringify(kwikHeaders), 'location');
        const kwikUrl = `https://${substringAfterLast(kwikLocation!, 'https://')}`;

        // Second request to kwikUrl
        const reskwik = await fetch(kwikUrl, {
          headers: {
            'Referer': 'https://kwik.cx/'
          }
        });

        // Extract token parts using regex
        const regex = /\"(\S+)\",\d+,\"(\S+)\",(\d+),(\d+)/;
        const matches = (await reskwik.text()).match(regex);
        if (!matches) {
          throw new Error('Failed to extract token parts');
        }

        // Decrypt the token
        const token = decrypt(
          matches[1]!,
          matches[2]!,
          matches[3]!,
          parseInt(matches[4]!)
        );

        // Extract URL and token from decrypted token
        const urlMatch = token.match(/action="([^"]+)"/);
        const tokMatch = token.match(/value="([^"]+)"/);

        if (!urlMatch || !tokMatch) {
          throw new Error('Failed to extract URL or token');
        }

        const url = urlMatch[1];
        const tok = tokMatch[1];

        let code = 419;
        let tries = 0;
        let location = '';

        // Retry loop
        while (code !== 302 && tries < 20) {
          let cookie = getMapValue(
            JSON.stringify(res.headers),
            'cookie'
          ) || '';

          const setCookie = getMapValue(JSON.stringify(reskwik.headers), 'set-cookie') || '';
          cookie += `; ${setCookie.replace('path=/;', '')}`;


          const resNo = await fetch(url!, {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'referer': reskwik.url,
              'cookie': cookie,
              'user-agent': getMapValue(
                JSON.stringify(res.headers),
                'user-agent'
              ) || '',
              'content-type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ _token: tok! }).toString()
          });

          code = resNo.status;
          tries++;
          location = getMapValue(JSON.stringify(resNo.headers), 'location') || '';

          if (code === 302) {
            break;
          }

          // Add a small delay between retries
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (tries >= 20) {
          throw new Error('Failed to extract the stream uri from kwik.');
        }

        const video = {
          title: `${audio} / ${quality}p`,
          url: location,
          id: `ap${animeId}--${quality}`,
          _quality: quality,
          _audio: audio,
        };
        videos.push(video);
      } else {
        // Direct link extraction
        const ress = await fetch(kwikLink!, { headers: { 'Referer': 'https://animepahe.com', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
        const body = await ress.text();
        const scriptNodes = parseHTML(body).document.querySelectorAll("script");
        const scriptNode = Array.from(scriptNodes).find((node) => node.innerHTML.includes("eval(function"));
        const script = substringAfterLast(scriptNode?.innerHTML ?? "", "eval(function(");
        const videoUrl = substringBefore(
          substringAfter(
            unpackJsAndCombine("eval(function(" + script),
            "const source='"
          ),
          "';"
        );
        const video = {
          title: `${audio} / ${quality}p`,
          url: videoUrl,
          id: `ap${animeId}--${quality}--${audio}`,
          _quality: quality,
          _audio: audio,
        };
        videos.push(video);
      }

    }

    videos.sort((a, b) => {
      return parseInt(b._quality ?? "") - parseInt(a._quality ?? "")
    });
    videos.map(v => { v.id, v.title, v.url });
    return videos;

  }
}


function proxyUrl(url: string, proxyBase: string) {
  return `${proxyBase}img/${encodeURIComponent(url)}`;
}

function substringBefore(str: string, pattern: string) {
  const endIndex = str.indexOf(pattern);
  if (endIndex === -1) {
    return str.substring(0);
  }
  return str.substring(0, endIndex);
}

function substringAfterLast(str: string, pattern: string) {
  return str.split(pattern).pop() || "";
}

function substringAfter(str: string, pattern: string) {
  const startIndex = str.indexOf(pattern);
  if (startIndex === -1) {
    return str.substring(0);
  }
  const start = startIndex + pattern.length;
  return str.substring(start);
}

function getMapValue(mapString: string, key: string): string | null {
  try {
    const map = JSON.parse(mapString);
    return map[key] != null ? map[key].toString() : "";
  } catch {
    return "";
  }
}


// We can inline the simplified getString logic for maximum efficiency.

/**
 * Decrypts the packed string payload from Kwik.
 * This is a direct port of the Dart decryption logic.
 *
 * @param packedStr The packed/encoded string (Dart: fS).
 * @param key The string containing the characters used for the base conversion.
 * @param offsetStr A string representation of an integer used as a character code offset (Dart: v1).
 * @param delimiterIndex The integer index pointing to the delimiter character within the `key` (Dart: v2).
 *                       Crucially, this is also used as the *base* for the number conversion.
 * @returns The decrypted HTML string.
 */
function decrypt(packedStr: string, key: string, offsetStr: string, delimiterIndex: number): string {
  let html = "";
  let i = 0;
  const offset = parseInt(offsetStr, 10);

  if (isNaN(offset)) {
    throw new Error("Invalid offset value for decryption.");
  }

  // `delimiterIndex` points to the character in the `key` that separates chunks.
  const delimiter = key[delimiterIndex];
  // `delimiterIndex` is also bizarrely used as the numerical base for parsing.
  const radix = delimiterIndex;

  while (i < packedStr.length) {
    let chunk = "";

    // 1. Read characters from the packed string until the delimiter is found.
    while (i < packedStr.length && packedStr[i] !== delimiter) {
      chunk += packedStr[i];
      i++;
    }

    // 2. Convert the chunk from its custom "alphabet" (the `key`) into a
    //    string of standard decimal digits.
    //    For example, if key="abc" and chunk="ba", it becomes "10".
    let chunkWithDigits = chunk;
    for (let j = 0; j < key.length; j++) {
      // String.prototype.replaceAll is supported in Cloudflare Workers.
      chunkWithDigits = chunkWithDigits.replaceAll(key[j]!, j.toString());
    }

    // 3. Perform the `getString` logic: parse the digit string using the
    //    `radix` (which is `delimiterIndex`), and convert it to a base-10 number.
    const numericValue = parseInt(chunkWithDigits, radix);

    // 4. Subtract the offset and convert the final number into a character.
    const charCode = numericValue - offset;
    html += String.fromCharCode(charCode);

    // 5. Move the main index past the delimiter to start the next chunk.
    i++;
  }

  return html;
}

function unpackJsAndCombine(js: string) {
  const unpacker = new JsUnpacker(js)
  if (unpacker.detect()) return unpacker.unpack();
  throw new Error(`Unable to unpack js
    
    JS: ${js}`)
}
