require('dotenv').config();
const config = require('./src/config');
const { createBot } = require('./src/bot');
const { createServer } = require('./src/server');

async function main() {
  console.log('------------------------------------------------------------');
  console.log('🚀 Starting TeraBox Fast Downloader & Streamer Telegram Bot');
  console.log('------------------------------------------------------------');

  if (!config.BOT_TOKEN) {
    console.error('❌ Error: BOT_TOKEN is not set in environment or config.');
    process.exit(1);
  }

  // 1. Create Bot instance
  const bot = createBot();

  // 2. Create and start HTTP Server
  const app = createServer(bot);
  const server = app.listen(config.PORT, () => {
    console.log(`🌐 Web server & health monitor listening on port ${config.PORT}`);
    console.log(`🖥️  Admin Dashboard URL: http://localhost:${config.PORT}/admin`);
    console.log(`📡 Health Check URL: http://localhost:${config.PORT}/health`);
  });

  // 3. Launch Bot with resilient auto-reconnect
  const startPolling = async (retryCount = 0) => {
    try {
      const botInfo = await bot.telegram.getMe();
      console.log(`🤖 Telegram Bot Connected: @${botInfo.username} (${botInfo.first_name})`);
      console.log(`💳 ShinzoAuto UPI VPA: ${config.UPI.VPA}`);
      console.log(`🔥 Firebase RTDB: ${config.FIREBASE_DB_URL}`);
      console.log(`⚡ VIP Plans: 24h (₹${config.PLANS['24h'].amount}), 30d (₹${config.PLANS['30d'].amount})`);

      // Ensure any webhook is cleared before polling
      await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});

      console.log('🔄 Starting Telegram long-polling...');
      bot.launch({
        dropPendingUpdates: false,
      }).then(() => {
        console.log('🛑 Bot polling stopped.');
      }).catch(async (err) => {
        console.error(`⚠️ Polling error (${err.message}). Reconnecting in 3s...`);
        setTimeout(() => startPolling(retryCount + 1), 3000);
      });
      console.log('✅ Bot polling is actively running and ready to handle user messages!');
    } catch (err) {
      console.error(`❌ Failed to start bot (${err.message}). Retrying in 5s...`);
      setTimeout(() => startPolling(retryCount + 1), 5000);
    }
  };

  await startPolling();

  // Graceful shutdown
  const stopSignals = ['SIGINT', 'SIGTERM'];
  for (const signal of stopSignals) {
    process.once(signal, () => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      bot.stop(signal);
      server.close(() => {
        console.log('👋 HTTP server closed.');
        process.exit(0);
      });
    });
  }
}

main().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
