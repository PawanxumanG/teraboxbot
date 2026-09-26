require('dotenv').config();

module.exports = {
  // Telegram Bot Token
  BOT_TOKEN: process.env.BOT_TOKEN || '8730987422:AAGZRo5MoD28TrCkQzRUbxkE7Wou-lkxuhA',

  // Firebase Realtime Database URL
  FIREBASE_DB_URL: (process.env.FIREBASE_DB_URL || 'https://shinzoverseapk-default-rtdb.firebaseio.com').replace(/\/+$/, ''),

  // UPI Monetization Details (ShinzoAuto)
  UPI: {
    VPA: process.env.UPI_VPA || 'pawanponnam@okicici',
    NAME: process.env.UPI_NAME || 'TeraBoxBot',
  },

  // VIP Subscription Plans
  PLANS: {
    '24h': {
      id: '24h',
      name: '⚡ 24-Hour Instant Pass',
      amount: 10,
      durationMs: 24 * 60 * 60 * 1000,
      durationLabel: '24 Hours',
      description: 'Unlimited downloads & high-speed streams for 24 hours.',
      maxFileSizeMb: 2048,
    },
    '10d': {
      id: '10d',
      name: '📦 10-Day VIP Pass',
      amount: 29,
      durationMs: 10 * 24 * 60 * 60 * 1000,
      durationLabel: '10 Days',
      description: 'Superfast download, 0 daily limit & folder support for 10 days.',
      maxFileSizeMb: 2048,
    },
    '30d': {
      id: '30d',
      name: '👑 30-Day Monthly Pass',
      amount: 49,
      durationMs: 30 * 24 * 60 * 60 * 1000,
      durationLabel: '30 Days',
      description: 'Unlimited downloads up to 2GB, priority processing & zero queue for 30 days.',
      maxFileSizeMb: 2048,
    },
    '90d': {
      id: '90d',
      name: '🌟 90-Day Quarterly Pass',
      amount: 139,
      durationMs: 90 * 24 * 60 * 60 * 1000,
      durationLabel: '90 Days',
      description: 'Priority queue, full speed CDN & unlimited files for 3 months.',
      maxFileSizeMb: 2048,
    },
    '365d': {
      id: '365d',
      name: '💎 1-Year VIP Unlimited Pass',
      amount: 349,
      durationMs: 365 * 24 * 60 * 60 * 1000,
      durationLabel: '1 Year',
      description: 'All-in-one VIP access for a full year with maximum bandwidth.',
      maxFileSizeMb: 2048,
    },
  },

  // Free Tier Restrictions
  FREE_TIER: {
    DAILY_LIMIT: 2, // 2 Free Bypasses per 24 hours
    MAX_FILE_SIZE_MB: 250, // 250 MB max file size for free users
  },

  // Max direct Telegram upload size in bytes (Bot API standard limit: 50MB, Local API: 2000MB)
  TELEGRAM_MAX_DIRECT_UPLOAD_BYTES: parseInt(process.env.TELEGRAM_MAX_UPLOAD_MB || '50', 10) * 1024 * 1024,

  // Optional Telegram Local Bot API Server URL (allows up to 2GB uploads directly to Telegram)
  TELEGRAM_API_ROOT: process.env.TELEGRAM_API_ROOT || undefined,

  // Admin Telegram User IDs (comma-separated, e.g. "123456789,987654321")
  ADMIN_IDS: (process.env.ADMIN_IDS || '8730987422')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // Server & Port Configuration
  PORT: process.env.PORT || 3000,

  // Optional TeraBox cookies for fallback / private share authentication
  COOKIE_JSON: process.env.COOKIE_JSON || '',
  TERABOX_NDUS: process.env.TERABOX_NDUS || 'YulOpexteHuig4PkWm4Ljay-xF87frJM7uzKGmOY',

  // Cloudflare Proxy Base URL
  PROXY_BASE_URL: process.env.PROXY_BASE_URL || 'https://tbx-proxy.shakir-ansarii075.workers.dev/',
};
