const axios = require('axios');
const { URL } = require('url');
const config = require('./config');

// Recognized TeraBox and redirector domains
const TERABOX_DOMAINS = [
  'terabox.com',
  'www.terabox.com',
  'teraboxapp.com',
  'www.teraboxapp.com',
  '1024tera.com',
  'www.1024tera.com',
  '1024terabox.com',
  'www.1024terabox.com',
  'teraboxshare.com',
  'www.teraboxshare.com',
  'teraboxlink.com',
  'www.teraboxlink.com',
  'mirrobox.com',
  'www.mirrobox.com',
  'nephobox.com',
  'www.nephobox.com',
  '4funbox.com',
  'www.4funbox.com',
  'freeterabox.com',
  'www.freeterabox.com',
  'momerybox.com',
  'www.momerybox.com',
  'tibibox.com',
  'www.tibibox.com',
  'gibibox.com',
  'www.gibibox.com',
  'terabox.fun',
  'www.terabox.fun',
  'terasharelink.com',
  'www.terasharelink.com',
  'terafileshare.com',
  'www.terafileshare.com',
  '1024nephobox.com',
  'www.1024nephobox.com',
  'terasharefile.com',
  'www.terasharefile.com',
  'teraboxurl.com',
  'www.teraboxurl.com',
  'teradownloader.com',
  'www.teradownloader.com',
  'dubox.com',
  'www.dubox.com',
  'terabox.me',
  'www.terabox.me',
  'nowplaytoc.com',
  'www.nowplaytoc.com',
  'nowplaylee.com',
  'www.nowplaylee.com',
  'nowplaygo.com',
  'www.nowplaygo.com',
  'hugeboxlightning.com',
  'hugeboxstack.com',
];

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.3gp'];

/**
 * Format bytes to readable size
 */
function formatBytes(bytes) {
  const num = parseInt(bytes, 10);
  if (isNaN(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(1024));
  return `${(num / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Extract all URLs from a text message
 */
function extractUrlsFromText(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s"'`<>]+/gi;
  return text.match(urlRegex) || [];
}

/**
 * Check if a URL matches any TeraBox or known redirector domain
 */
function isValidTeraBoxUrl(urlString) {
  try {
    const parsed = new URL(urlString.trim());
    const host = parsed.hostname.toLowerCase();
    const isDomainMatch = TERABOX_DOMAINS.some(
      (d) => host === d || host.endsWith('.' + d)
    );
    if (isDomainMatch) return true;
    return parsed.pathname.includes('/s/') || parsed.search.includes('surl=') || parsed.search.includes('shorturl=');
  } catch {
    return false;
  }
}

/**
 * Extract surl / short key from URL
 */
function extractShortCode(urlString) {
  try {
    const parsed = new URL(urlString.trim());
    if (parsed.searchParams.has('surl')) {
      let code = parsed.searchParams.get('surl');
      if (code.startsWith('1') && code.length > 22) code = code.slice(1);
      return code;
    }
    if (parsed.searchParams.has('shorturl')) {
      let code = parsed.searchParams.get('shorturl');
      if (code.startsWith('1') && code.length > 22) code = code.slice(1);
      return code;
    }
    const match = parsed.pathname.match(/\/s\/(?:1)?([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      let code = match[1];
      if (code.startsWith('1') && code.length > 22) code = code.slice(1);
      return code;
    }
    const pathMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_-]{20,})$/);
    if (pathMatch && pathMatch[1]) {
      let code = pathMatch[1];
      if (code.startsWith('1') && code.length > 22) code = code.slice(1);
      return code;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Universal Link Resolver:
 * - Checks direct TeraBox domains & extract surl
 * - Resolves shorteners / redirectors (nowplaytoc, bit.ly, tinyurl, etc.)
 * - Parses Nuxt data, meta refresh, window.location, and HTML for embedded TeraBox links
 */
async function resolveToTeraBoxSurl(inputUrl) {
  let url = inputUrl.trim();
  let surl = extractShortCode(url);
  if (surl) return { surl, finalUrl: url };

  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 12000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const finalUrl = res.request?.res?.responseUrl || res.config?.url || url;
    surl = extractShortCode(finalUrl);
    if (surl) return { surl, finalUrl };

    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

    const surlMatch =
      body.match(/\/s\/(?:1)?([a-zA-Z0-9_-]{15,})/i) ||
      body.match(/[?&]surl=(?:1)?([a-zA-Z0-9_-]{15,})/i) ||
      body.match(/["']surl["']\s*:\s*["'](?:1)?([a-zA-Z0-9_-]{15,})["']/i) ||
      body.match(/["']shorturl["']\s*:\s*["'](?:1)?([a-zA-Z0-9_-]{15,})["']/i);

    if (surlMatch && surlMatch[1]) {
      let code = surlMatch[1];
      if (code.startsWith('1') && code.length > 22) code = code.slice(1);
      return { surl: code, finalUrl };
    }

    const teraboxUrlMatch = body.match(
      /https?:\/\/[a-zA-Z0-9_\-\.]*(?:terabox|1024tera|mirrobox|nephobox|4funbox|momerybox|tibibox|freeterabox|gibibox|dubox)[a-zA-Z0-9_\-\.]*\/[a-zA-Z0-9_\-\/?=&]+/i
    );
    if (teraboxUrlMatch && teraboxUrlMatch[0]) {
      const extracted = extractShortCode(teraboxUrlMatch[0]);
      if (extracted) return { surl: extracted, finalUrl: teraboxUrlMatch[0] };
    }

    if (body.includes('"NO_DATA"') || body.includes('Link Expired') || body.includes('Deleted')) {
      return { surl: null, error: '⚠️ The shared shortlink has expired or been removed by its creator.' };
    }

    return { surl: null, error: 'Could not find an active TeraBox destination from this link.' };
  } catch (err) {
    return { surl: null, error: `Failed to resolve link (${err.message}).` };
  }
}

/**
 * Check if filename represents a playable video
 */
function isVideoFile(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Resolve direct download link by following redirects or checking Location header
 */
async function resolveDirectLink(dlink, cookies = '') {
  if (!dlink) return null;
  try {
    const res = await axios.head(dlink, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Cookie: cookies || (config.TERABOX_NDUS ? `ndus=${config.TERABOX_NDUS}` : ''),
      },
      timeout: 10000,
    });
    return res.headers.location || dlink;
  } catch (error) {
    if (error.response && error.response.headers && error.response.headers.location) {
      return error.response.headers.location;
    }
    return dlink;
  }
}

/**
 * Strategy 1: Unified Cloudflare Worker Proxy
 */
async function extractViaProxy(surl, password = '') {
  try {
    const proxyUrl = config.PROXY_BASE_URL.replace(/\/+$/, '') + '/';
    const params = {
      mode: 'resolve',
      surl: surl,
      raw: '1',
    };
    if (password) params.pwd = password;

    const res = await axios.get(proxyUrl, {
      params,
      timeout: 25000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      },
    });

    const data = res.data;
    if (!data) return null;
    if (data.error) {
      console.warn(`[Extractor Proxy] Proxy error: ${data.error}`);
      return null;
    }

    const upstream = data.upstream || data.data || data;
    if (upstream.errno && upstream.errno !== 0) {
      return { errorErrno: upstream.errno, message: upstream.errmsg || 'API error' };
    }

    const list = upstream.list || [];
    if (!Array.isArray(list) || list.length === 0) return null;

    const results = [];
    for (const item of list) {
      const filename = item.server_filename || item.filename || 'TeraBox_File';
      const sizeBytes = parseInt(item.size || 0, 10);
      const dlink = item.dlink || item.download_link || '';
      const thumb = (item.thumbs && (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1)) || '';

      results.push({
        filename,
        size: formatBytes(sizeBytes),
        size_bytes: sizeBytes,
        download_link: dlink,
        direct_link: dlink,
        stream_link: dlink,
        thumbnail: thumb,
        is_video: isVideoFile(filename),
        is_directory: item.isdir === '1' || item.is_directory === true,
        fs_id: item.fs_id || '',
      });
    }

    return results;
  } catch (error) {
    console.warn(`[Extractor Proxy] Error: ${error.message}`);
    return null;
  }
}

/**
 * Strategy 1: Direct Authenticated TeraBox Web API & Token Scraper with Folder Expansion
 */
async function extractViaNativeWeb(surl) {
  try {
    const ndus = config.TERABOX_NDUS;
    const cookieHeader = ndus ? `ndus=${ndus}` : '';
    const domains = ['dm.1024terabox.com', 'www.1024terabox.com', 'www.terabox.app'];
    let jsToken = null;
    let workingDomain = domains[0];

    for (const dom of domains) {
      try {
        const pageRes = await axios.get(`https://${dom}/sharing/link?surl=${surl}`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Cookie: cookieHeader,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          timeout: 12000,
        });

        const html = pageRes.data || '';
        const tokenMatch =
          html.match(/fn%28%22([A-Za-z0-9]+)%22%29/) ||
          html.match(/fn\([\"']([A-Za-z0-9]+)[\"']\)/) ||
          html.match(/\"jsToken\"\s*:\s*\"([A-Za-z0-9]+)\"/);

        if (tokenMatch && tokenMatch[1]) {
          jsToken = tokenMatch[1];
          workingDomain = dom;
          break;
        }
      } catch (err) {
        console.warn(`[Extractor Native] Domain ${dom} check failed: ${err.message}`);
      }
    }

    if (!jsToken) {
      console.warn('[Extractor Native] Could not extract jsToken from any domain');
      return null;
    }

    // Request root list
    const listRes = await axios.get('https://www.1024terabox.com/share/list', {
      params: {
        app_id: '250528',
        web: '1',
        channel: 'dubox',
        clienttype: '0',
        jsToken: jsToken,
        shorturl: surl,
        root: '1',
        page: '1',
        num: '100',
        order: 'asc',
        by: 'name',
      },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Cookie: cookieHeader,
        Referer: `https://${workingDomain}/sharing/link?surl=${surl}`,
      },
      timeout: 15000,
    });

    const listData = listRes.data;
    if (!listData || listData.errno !== 0 || !Array.isArray(listData.list)) {
      console.warn(`[Extractor Native] share/list returned errno: ${listData?.errno}`);
      return null;
    }

    let rawList = listData.list;

    // Expand directory if root contains a folder
    if (rawList.length === 1 && (rawList[0].isdir === '1' || rawList[0].isdir === 1)) {
      const folderPath = rawList[0].path;
      console.log(`[Extractor Native] Root is directory (${folderPath}), expanding sub-files...`);
      try {
        const subRes = await axios.get('https://www.1024terabox.com/share/list', {
          params: {
            app_id: '250528',
            web: '1',
            channel: 'dubox',
            clienttype: '0',
            jsToken: jsToken,
            shorturl: surl,
            root: '0',
            dir: folderPath,
            page: '1',
            num: '100',
            order: 'asc',
            by: 'name',
          },
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Cookie: cookieHeader,
            Referer: `https://${workingDomain}/sharing/link?surl=${surl}`,
          },
          timeout: 15000,
        });

        if (subRes.data && subRes.data.errno === 0 && Array.isArray(subRes.data.list)) {
          rawList = subRes.data.list;
        }
      } catch (err) {
        console.warn(`[Extractor Native] Sub-directory expansion failed: ${err.message}`);
      }
    }

    const results = [];
    for (const item of rawList) {
      if (item.isdir === '1' || item.isdir === 1) continue; // Skip subdirectories

      const filename = item.server_filename || item.filename || 'TeraBox_File';
      const sizeBytes = parseInt(item.size || 0, 10);
      const fsId = item.fs_id || '';
      const dlink = item.dlink || '';
      const directWebLink = `https://1024terabox.com/s/1${surl}?fid=${fsId}`;
      const effectiveLink = dlink || directWebLink;
      const thumb = (item.thumbs && (item.thumbs.url3 || item.thumbs.url2 || item.thumbs.url1)) || '';

      results.push({
        filename,
        size: formatBytes(sizeBytes),
        size_bytes: sizeBytes,
        download_link: effectiveLink,
        direct_link: effectiveLink,
        stream_link: dlink || item.docpreview || effectiveLink,
        thumbnail: thumb,
        is_video: isVideoFile(filename) || item.category === 1,
        is_directory: false,
        fs_id: fsId,
      });
    }

    return results;
  } catch (error) {
    console.warn(`[Extractor Native] Error: ${error.message}`);
    return null;
  }
}

/**
 * Strategy 3: Public Fallback Worker Resolvers
 */
async function extractViaPublicGateways(surl) {
  const publicGateways = [
    `https://terabox-dl.qtcloud.workers.dev/api/get-info?shorturl=${surl}`,
    `https://terabox.hnn.workers.dev/api/get-info?shorturl=${surl}`,
  ];

  for (const endpoint of publicGateways) {
    try {
      const res = await axios.get(endpoint, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });

      if (res.data && res.data.list && Array.isArray(res.data.list)) {
        const results = [];
        for (const item of res.data.list) {
          const filename = item.server_filename || item.filename || 'TeraBox_File';
          const sizeBytes = parseInt(item.size || 0, 10);
          const dlink = item.dlink || item.direct_link || '';
          const thumb = (item.thumbs && (item.thumbs.url3 || item.thumbs.url2)) || '';

          results.push({
            filename,
            size: formatBytes(sizeBytes),
            size_bytes: sizeBytes,
            download_link: dlink,
            direct_link: dlink,
            stream_link: dlink,
            thumbnail: thumb,
            is_video: isVideoFile(filename),
            is_directory: item.isdir === '1',
            fs_id: item.fs_id || '',
          });
        }
        if (results.length > 0) return results;
      }
    } catch {
      // Continue to next gateway
    }
  }

  return null;
}

/**
 * Main Extract Function combining all strategies with automatic fallback
 * @param {string} rawUrl 
 * @param {string} password 
 */
async function extractTeraBox(rawUrl, password = '') {
  // First resolve any shortlink or redirect to a surl
  const resolved = await resolveToTeraBoxSurl(rawUrl);
  if (!resolved.surl) {
    return {
      success: false,
      error: resolved.error || 'Invalid TeraBox URL format. Please provide a valid link from terabox.com, teraboxapp.com, 1024tera.com, or supported shortlinks.',
    };
  }

  const surl = resolved.surl;
  console.log(`[Extractor] Resolving TeraBox link for surl: ${surl} (source: ${rawUrl})...`);

  // Try Strategy 1: Direct Native Authenticated Scraper (Fastest, zero proxy lag)
  let files = await extractViaNativeWeb(surl);

  // Try Strategy 2: Unified Cloudflare Proxy
  if (!files || files.length === 0) {
    console.log('[Extractor] Strategy 1 failed, trying Strategy 2 (Cloudflare Proxy)...');
    files = await extractViaProxy(surl, password);
  }

  // Try Strategy 3: Public Gateways
  if (!files || files.length === 0) {
    console.log('[Extractor] Strategy 2 failed, trying Strategy 3 (Public Gateways)...');
    files = await extractViaPublicGateways(surl);
  }

  if (!files || files.length === 0) {
    return {
      success: false,
      error: '⚠️ Unable to extract files from this link. The link may have expired, been deleted by the owner, or requires a password/captcha verification.',
    };
  }

  // Resolve direct redirect links for the first few files
  for (let i = 0; i < Math.min(files.length, 3); i++) {
    if (files[i].download_link && files[i].download_link.includes('pcs.1024terabox.com')) {
      const direct = await resolveDirectLink(files[i].download_link);
      if (direct) {
        files[i].direct_link = direct;
        files[i].stream_link = direct;
      }
    }
  }

  return {
    success: true,
    surl,
    totalFiles: files.length,
    files,
  };
}

module.exports = {
  TERABOX_DOMAINS,
  isValidTeraBoxUrl,
  extractShortCode,
  extractUrlsFromText,
  resolveToTeraBoxSurl,
  formatBytes,
  isVideoFile,
  extractTeraBox,
};
