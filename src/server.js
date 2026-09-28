const express = require('express');
const path = require('path');
const { Telegram } = require('telegraf');
const config = require('./config');
const database = require('./database');
const extractor = require('./extractor');

function createServer(bot) {
  const app = express();
  app.use(express.json());

  // Initialize Telegram client (works even in standalone dashboard mode)
  const telegram = bot?.telegram || (config.BOT_TOKEN ? new Telegram(config.BOT_TOKEN) : null);

  // Serve Dashboard static files
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // Admin Dashboard routes
  app.get(['/dashboard', '/admin'], (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Health check endpoint
  app.get('/health', async (req, res) => {
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
    });
  });

  // --- ADMIN REST API ENDPOINTS ---

  // 1. Overview & KPIs
  app.get('/api/admin/overview', async (req, res) => {
    try {
      const stats = await database.getAdminStats();
      res.json({
        ...stats,
        uptime: process.uptime(),
        botOnline: Boolean(telegram),
        vpa: config.UPI.VPA,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 2. Users Directory
  app.get('/api/admin/users', async (req, res) => {
    try {
      const users = await database.getAllUsers();
      res.json({ users });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Grant VIP
  app.post('/api/admin/users/grant-vip', async (req, res) => {
    try {
      const { userId, days } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const durationDays = parseInt(days, 10) || 30;

      const result = await database.manualGrantVip(userId, durationDays);
      if (result.success && telegram) {
        const expStr = new Date(result.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        telegram.sendMessage(
          userId,
          `🎉 *VIP Access Granted!*\n\nAn administrator has granted you *${durationDays} days of VIP Pass*!\n📅 Valid until: \`${expStr} IST\`\n⚡ Enjoy unlimited downloads!`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. Revoke VIP
  app.post('/api/admin/users/revoke-vip', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const result = await database.manualRevokeVip(userId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 5. Reset Quota
  app.post('/api/admin/users/reset-quota', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const result = await database.resetUserQuota(userId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 6. Direct Message to User
  app.post('/api/admin/users/send-message', async (req, res) => {
    try {
      const { userId, message } = req.body;
      if (!userId || !message) return res.status(400).json({ error: 'Missing userId or message' });
      if (!telegram) return res.status(500).json({ error: 'Telegram Bot Token not configured' });

      await telegram.sendMessage(userId, `💬 *Message from Admin:*\n\n${message}`, {
        parse_mode: 'Markdown',
      });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 7. Toggle Ban
  app.post('/api/admin/users/toggle-ban', async (req, res) => {
    try {
      const { userId, isBanned } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });
      const result = await database.toggleUserBan(userId, isBanned);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 8. Redemptions List
  app.get('/api/admin/redemptions', async (req, res) => {
    try {
      const list = await database.getAllRedemptions();
      res.json({ redemptions: list });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 9. Global Broadcast Announcement
  app.post('/api/admin/broadcast', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Missing message' });
      if (!telegram) return res.status(500).json({ error: 'Telegram Bot Token not configured' });

      const userIds = await database.getAllUserIds();
      let sent = 0;

      for (const u of userIds) {
        try {
          await telegram.sendMessage(u, `📢 *Announcement*\n\n${message}`, {
            parse_mode: 'Markdown',
          });
          sent++;
          await new Promise((r) => setTimeout(r, 40)); // 25 msgs/sec rate limit
        } catch {}
      }

      res.json({ success: true, sent, total: userIds.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 10. Link Extractor Tester
  app.post('/api/admin/test-extract', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'Missing url' });
      const extractResult = await extractor.extractTeraBox(url);
      res.json(extractResult);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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

      if (note && note.startsWith('USER_')) {
        const parts = note.split('_');
        const targetUserId = parts[1];
        const planId = parts[2] || (parseFloat(amount) >= 49 ? '30d' : '24h');

        if (targetUserId && utr) {
          const result = await database.verifyAndRedeemUtr(targetUserId, utr, planId);
          if (result.success && telegram) {
            const expDate = new Date(result.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
            telegram.sendMessage(
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
