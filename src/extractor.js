const axios = require('axios');
const { URL } = require('url');
const config = require('./config');

// Recognized TeraBox domains
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
 * Check if a URL matches any TeraBox domain
 */
function isValidTeraBoxUrl(urlString) {
  try {
    const parsed = new URL(urlString.trim());
    const host = parsed.hostname.toLowerCase();
    const isDomainMatch = TERABOX_DOMAINS.some(
      (d) => host === d || host.endsWith('.' + d)
    );
    if (!isDomainMatch) return false;
    return parsed.pathname.includes('/s/') || parsed.search.includes('surl=');
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
      if (code.startsWith('1')) code = code.slice(1);
      return code;
    }
    const match = parsed.pathname.match(/\/s\/(?:1)?([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch {
    return null;
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
 * Strategy 2: Direct TeraBox Web API & Token Scraper
 */
async function extractViaNativeWeb(surl) {
  try {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const initialUrl = `https://www.terabox.app/sharing/link?surl=${surl}`;

    const pageRes = await axios.get(initialUrl, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 20000,
    });

    const html = pageRes.data || '';
    const cookieHeader = pageRes.headers['set-cookie']
      ? pageRes.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ')
      : '';

    // Extract jsToken from page
    let jsToken = null;
    const tokenMatch =
      html.match(/fn%28%22([A-Za-z0-9]+)%22%29/) ||
      html.match(/fn\([\"\']([A-Za-z0-9]+)[\"\']\)/) ||
      html.match(/\"jsToken\"\s*:\s*\"([A-Za-z0-9]+)\"/);

    if (tokenMatch && tokenMatch[1]) {
      jsToken = tokenMatch[1];
    }

    // Extract logid
    let logid = pageRes.headers['logid'] || pageRes.headers['Logid'];
    if (!logid) {
      const logMatch = html.match(/dp-logid=([0-9]+)/) || html.match(/\"dplogid\"\s*:\s*\"?([0-9]+)\"?/);
      if (logMatch && logMatch[1]) {
        logid = logMatch[1];
      }
    }

    if (!jsToken) {
      console.warn('[Extractor Native] Could not extract jsToken from page');
      return null;
    }

    // Request file list
    const listUrl = 'https://www.terabox.app/share/list';
    const params = {
      app_id: '250528',
      web: '1',
      channel: 'dubox',
      clienttype: '0',
      jsToken: jsToken,
      'dp-logid': logid || '',
      page: '1',
      num: '50',
      by: 'name',
      order: 'asc',
      shorturl: surl,
      root: '1',
    };

    const listRes = await axios.get(listUrl, {
      params,
      headers: {
        'User-Agent': userAgent,
        Referer: initialUrl,
        Cookie: cookieHeader,
      },
      timeout: 20000,
    });

    const listData = listRes.data;
    if (!listData || listData.errno !== 0 || !Array.isArray(listData.list)) {
      return null;
    }

    const results = [];
    for (const item of listData.list) {
      const filename = item.server_filename || item.filename || 'TeraBox_File';
      const sizeBytes = parseInt(item.size || 0, 10);
      const dlink = item.dlink || '';
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
        is_directory: item.isdir === '1',
        fs_id: item.fs_id || '',
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
  if (!isValidTeraBoxUrl(rawUrl)) {
    return {
      success: false,
      error: 'Invalid TeraBox URL format. Please provide a valid link from terabox.com, teraboxapp.com, or 1024tera.com.',
    };
  }

  const surl = extractShortCode(rawUrl);
  if (!surl) {
    return {
      success: false,
      error: 'Could not extract short code (surl) from the provided link.',
    };
  }

  console.log(`[Extractor] Resolving TeraBox link for surl: ${surl}...`);

  // Try Strategy 1: Unified Cloudflare Proxy
  let files = await extractViaProxy(surl, password);

  // Try Strategy 2: Native Web Scraper
  if (!files || files.length === 0) {
    console.log('[Extractor] Strategy 1 failed, trying Strategy 2 (Native Web Scraper)...');
    files = await extractViaNativeWeb(surl);
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
    if (files[i].download_link) {
      const resolved = await resolveDirectLink(files[i].download_link);
      if (resolved) {
        files[i].direct_link = resolved;
        files[i].stream_link = resolved;
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
  isValidTeraBoxUrl,
  extractShortCode,
  formatBytes,
  isVideoFile,
  extractTeraBox,
};
