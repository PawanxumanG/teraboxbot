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
      name: '⚡ 24-Hour Instant VIP Pass',
      amount: 10,
      durationMs: 24 * 60 * 60 * 1000, // 24 Hours
      durationLabel: '24 Hours',
      description: 'Unlimited downloads & 1080p high-speed streams for 24 hours.',
      maxFileSizeMb: 2048,
    },
    '30d': {
      id: '30d',
      name: '👑 30-Day Monthly VIP Pass',
      amount: 49,
      durationMs: 30 * 24 * 60 * 60 * 1000, // 30 Days
      durationLabel: '30 Days',
      description: 'Unlimited downloads up to 2GB, priority processing & zero queue for 30 days.',
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
  TERABOX_NDUS: process.env.TERABOX_NDUS || '',

  // Cloudflare Proxy Base URL
  PROXY_BASE_URL: process.env.PROXY_BASE_URL || 'https://tbx-proxy.shakir-ansarii075.workers.dev/',
};
