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
    console.log(`📡 Health Check URL: http://localhost:${config.PORT}/health`);
  });

  // 3. Launch Bot
  try {
    const botInfo = await bot.telegram.getMe();
    console.log(`🤖 Telegram Bot Connected: @${botInfo.username} (${botInfo.first_name})`);
    console.log(`💳 ShinzoAuto UPI VPA: ${config.UPI.VPA}`);
    console.log(`🔥 Firebase RTDB: ${config.FIREBASE_DB_URL}`);
    console.log(`⚡ VIP Plans: 24h (₹${config.PLANS['24h'].amount}), 30d (₹${config.PLANS['30d'].amount})`);

    // Start polling
    await bot.launch({
      dropPendingUpdates: true,
    });
    console.log('✅ Bot polling is actively running and ready to handle user links!');
  } catch (err) {
    console.error('❌ Failed to start bot:', err.message);
  }

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
