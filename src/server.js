const express = require('express');
const config = require('./config');
const database = require('./database');

function createServer(bot) {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get(['/', '/health'], async (req, res) => {
    let dbStatus = 'connected';
    try {
      await database.getUser('health_probe');
    } catch {
      dbStatus = 'degraded';
    }

    res.json({
      status: 'online',
      service: 'TeraBox Fast Downloader & Streamer Telegram Bot',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbStatus,
      monetization: {
        upi_vpa: config.UPI.VPA,
        plans: Object.values(config.PLANS).map((p) => ({
          name: p.name,
          amount: p.amount,
          duration: p.durationLabel,
        })),
      },
    });
  });

  // Optional Telegram Webhook route (if using webhook mode)
  app.post('/webhook', (req, res) => {
    if (bot && typeof bot.handleUpdate === 'function') {
      bot.handleUpdate(req.body, res);
    } else {
      res.sendStatus(200);
    }
  });

  // ShinzoAuto Webhook route for instant push notifications
  app.post('/shinzo-webhook', async (req, res) => {
    try {
      const payload = req.body || {};
      const { utr, amount, sender, note } = payload;
      console.log(`[Shinzo Webhook] Received payment alert for UTR: ${utr}, Amount: ₹${amount}`);

      // If note contains USER_<ID>_<PLAN>, auto-activate VIP immediately
      if (note && note.startsWith('USER_')) {
        const parts = note.split('_');
        const targetUserId = parts[1];
        const planId = parts[2] || (parseFloat(amount) >= 49 ? '30d' : '24h');

        if (targetUserId && utr) {
          const result = await database.verifyAndRedeemUtr(targetUserId, utr, planId);
          if (result.success && bot) {
            const expDate = new Date(result.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            bot.telegram.sendMessage(
              targetUserId,
              `🎉 *Instant VIP Activation!*\n\n` +
              `Your payment of ₹${result.amount} via UPI (UTR: \`${utr}\`) was verified automatically.\n` +
              `👑 *Plan:* ${result.plan.name}\n` +
              `📅 *Active Until:* \`${expDate} IST\`\n\n` +
              `Enjoy unlimited downloads!`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
        }
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error('[Shinzo Webhook] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = {
  createServer,
};
