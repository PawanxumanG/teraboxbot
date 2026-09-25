const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const database = require('./database');
const extractor = require('./extractor');
const payment = require('./payment');
const downloader = require('./downloader');

// In-memory state for user pending actions (e.g. awaiting UTR, pending links)
const userSessions = new Map();

function getSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      selectedPlan: '24h',
      awaitingUtr: false,
      pendingLink: null,
    });
  }
  return userSessions.get(userId);
}

/**
 * Initialize Telegraf Bot
 */
function createBot() {
  const botOptions = {};
  if (config.TELEGRAM_API_ROOT) {
    botOptions.telegram = { apiRoot: config.TELEGRAM_API_ROOT };
  }

  const bot = new Telegraf(config.BOT_TOKEN, botOptions);

  // Middleware: Register / Update user in Firebase on every message
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await database.initUser(ctx.from.id, {
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
      });
    }
    return next();
  });

  // /start command
  bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const name = ctx.from.first_name || 'User';
    const quota = await database.checkUserQuota(userId);

    let statusText = '';
    if (quota.isVip) {
      const expDate = new Date(quota.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      statusText = `👑 *VIP Member*\nExpires: \`${expDate} IST\`\n⚡ Unlimited Downloads Active`;
    } else {
      statusText = `🆓 *Free Tier*\nDownloads remaining today: *${quota.remainingFree}/${config.FREE_TIER.DAILY_LIMIT}*\nMax file size: *${config.FREE_TIER.MAX_FILE_SIZE_MB}MB*`;
    }

    const welcomeMsg =
      `👋 *Welcome to TeraBox Fast Downloader & Streamer*, ${name}!\n\n` +
      `Send any TeraBox link to instantly get direct high-speed video streams and downloads — bypassing app requirements, speed caps, and ads!\n\n` +
      `📊 *Your Account Status:*\n${statusText}\n\n` +
      `👇 *Send a TeraBox link or choose an option below:*`;

    await ctx.reply(welcomeMsg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚡ 24-Hour VIP Pass (₹10)', callback_data: 'plan_24h' },
            { text: '👑 30-Day Monthly (₹49)', callback_data: 'plan_30d' },
          ],
          [
            { text: '📊 My Status & Quota', callback_data: 'check_status' },
            { text: '❓ Help & Supported Links', callback_data: 'help_info' },
          ],
        ],
      },
    });
  });

  // /buy or /upgrade command
  bot.command(['buy', 'upgrade'], async (ctx) => {
    await sendPlanSelection(ctx);
  });

  // /status command
  bot.command('status', async (ctx) => {
    await sendStatusMessage(ctx);
  });

  // /help command
  bot.command('help', async (ctx) => {
    await sendHelpMessage(ctx);
  });

  // /utr <number> command
  bot.command('utr', async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply(
        `✍️ *Please provide your 12-digit UTR number:*\n\nExample: \`/utr 123456789012\``,
        { parse_mode: 'Markdown' }
      );
    }
    const utr = parts[1].trim();
    await handleUtrSubmission(ctx, utr);
  });

  // Admin Commands: /admin, /grant, /revoke, /broadcast
  bot.command('admin', async (ctx) => {
    const userId = String(ctx.from.id);
    if (!config.ADMIN_IDS.includes(userId)) {
      return ctx.reply('⛔ Unauthorized. Admin access only.');
    }

    const stats = await database.getAdminStats();
    await ctx.reply(
      `🛠️ *TeraBox Bot Admin Panel*\n\n` +
      `👥 *Total Users:* ${stats.totalUsers}\n` +
      `💰 *Total Revenue:* ₹${stats.totalRevenue}\n` +
      `🎟️ *Total VIP Redemptions:* ${stats.totalRedemptions}\n\n` +
      `*Admin Commands:*\n` +
      `• \`/grant <user_id> <days>\` - Grant VIP to a user\n` +
      `• \`/revoke <user_id>\` - Revoke VIP from a user\n` +
      `• \`/broadcast <message>\` - Send announcement to all users`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('grant', async (ctx) => {
    const userId = String(ctx.from.id);
    if (!config.ADMIN_IDS.includes(userId)) return;

    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply('Usage: `/grant <user_id> <days>`', { parse_mode: 'Markdown' });
    }

    const targetUser = parts[1];
    const days = parseInt(parts[2], 10) || 30;
    const res = await database.manualGrantVip(targetUser, days);

    if (res.success) {
      const expStr = new Date(res.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      await ctx.reply(`✅ Granted ${days} days VIP to user \`${targetUser}\`. Active until: \`${expStr}\``, {
        parse_mode: 'Markdown',
      });
      // Notify user
      try {
        await ctx.telegram.sendMessage(
          targetUser,
          `🎉 *VIP Access Granted!*\n\nAn administrator has granted you *${days} days of VIP Pass*! Enjoy unlimited high-speed downloads until \`${expStr}\`!`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    } else {
      await ctx.reply(`❌ Failed to grant VIP: ${res.error}`);
    }
  });

  bot.command('revoke', async (ctx) => {
    const userId = String(ctx.from.id);
    if (!config.ADMIN_IDS.includes(userId)) return;

    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('Usage: `/revoke <user_id>`', { parse_mode: 'Markdown' });
    }

    const targetUser = parts[1];
    await database.manualRevokeVip(targetUser);
    await ctx.reply(`✅ VIP revoked for user \`${targetUser}\``, { parse_mode: 'Markdown' });
  });

  bot.command('broadcast', async (ctx) => {
    const userId = String(ctx.from.id);
    if (!config.ADMIN_IDS.includes(userId)) return;

    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) {
      return ctx.reply('Usage: `/broadcast <announcement text>`');
    }

    const users = await database.getAllUserIds();
    await ctx.reply(`📢 Sending broadcast to ${users.length} users...`);

    let sent = 0;
    for (const u of users) {
      try {
        await ctx.telegram.sendMessage(u, `📢 *Announcement*\n\n${msg}`, { parse_mode: 'Markdown' });
        sent++;
        await new Promise((r) => setTimeout(r, 40)); // Rate limit 25 msgs/sec
      } catch {}
    }

    await ctx.reply(`✅ Broadcast sent to ${sent}/${users.length} users.`);
  });

  // Callback query handlers
  bot.action('upgrade_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendPlanSelection(ctx);
  });

  bot.action('check_status', async (ctx) => {
    await ctx.answerCbQuery();
    await sendStatusMessage(ctx);
  });

  bot.action('help_info', async (ctx) => {
    await ctx.answerCbQuery();
    await sendHelpMessage(ctx);
  });

  bot.action('plan_24h', async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlanSelected(ctx, '24h');
  });

  bot.action('plan_30d', async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlanSelected(ctx, '30d');
  });

  bot.action(/^submit_utr_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planId = ctx.match[1];
    const session = getSession(ctx.from.id);
    session.selectedPlan = planId;
    session.awaitingUtr = true;

    await ctx.reply(
      `✍️ *Submit 12-Digit UTR for ${config.PLANS[planId].name}:*\n\n` +
      `Please reply with your *12-digit UTR / UPI Transaction Reference Number* (or send \`/utr <number>\`).`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
        },
      }
    );
  });

  // Message Handler: Links and UTR inputs
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;
    const session = getSession(userId);

    // 1. Check if user is entering a 12-digit UTR (either in awaiting state or just 12 digits)
    const is12DigitNumber = /^\d{12}$/.test(text);
    if (session.awaitingUtr || is12DigitNumber) {
      if (is12DigitNumber) {
        session.awaitingUtr = false;
        return handleUtrSubmission(ctx, text);
      } else if (session.awaitingUtr) {
        return ctx.reply(
          `⚠️ *Invalid UTR Format*\nA UTR must be a 12-digit numerical reference number (e.g. \`613196476271\`).\n` +
          `Please check your payment receipt and try again.`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    // 2. Check if text contains a TeraBox link
    if (extractor.isValidTeraBoxUrl(text)) {
      return handleTeraBoxLink(ctx, text);
    }

    // Default response for unmatched text
    await ctx.reply(
      `🤖 *Send me any TeraBox link to download or stream!*\n\n` +
      `Supported domains include:\n` +
      `• \`terabox.com\`, \`teraboxapp.com\`\n` +
      `• \`1024tera.com\`, \`teraboxshare.com\`\n` +
      `• \`mirrobox.com\`, \`4funbox.com\`, \`nephobox.com\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👑 Upgrade to VIP (Unlimited)', callback_data: 'upgrade_menu' }],
            [{ text: '📊 Check My Quota', callback_data: 'check_status' }],
          ],
        },
      }
    );
  });

  return bot;
}

/**
 * Handle Plan Selection and generate QR code
 */
async function sendPlanSelection(ctx) {
  const msg =
    `👑 *Upgrade to TeraBox VIP Pass*\n\n` +
    `⚡ *24-Hour Instant Pass: ₹10*\n` +
    `• Unlimited downloads for 24 hours\n` +
    `• High-speed 1080p video streaming\n` +
    `• Max file size: 2GB\n\n` +
    `👑 *30-Day Monthly Pass: ₹49*\n` +
    `• Unlimited downloads for 30 days\n` +
    `• Max file size: 2GB\n` +
    `• Zero queue & priority processing\n\n` +
    `👇 *Select your VIP pass to proceed with instant UPI:*`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '⚡ 24-Hour Pass (₹10)', callback_data: 'plan_24h' }],
        [{ text: '👑 30-Day Monthly Pass (₹49)', callback_data: 'plan_30d' }],
        [{ text: '📊 My Status', callback_data: 'check_status' }],
      ],
    },
  });
}

/**
 * Handle plan payment QR generation
 */
async function handlePlanSelected(ctx, planId) {
  const plan = config.PLANS[planId];
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.selectedPlan = planId;

  const upiUrl = payment.generateUpiUrl(userId, planId);
  const qrBuffer = await payment.generateQrBuffer(upiUrl);

  const caption =
    `⚡ *Payment Details for ${plan.name}*\n\n` +
    `💰 *Amount:* ₹${plan.amount}\n` +
    `🆔 *UPI ID:* \`${config.UPI.VPA}\`\n` +
    `📝 *Payment Reference:* \`USER_${userId}_${plan.id}\`\n\n` +
    `*Instructions to Activate:* \n` +
    `1️⃣ Scan the QR code above or pay *₹${plan.amount}* to \`${config.UPI.VPA}\`.\n` +
    `2️⃣ Open your UPI App (GPay/PhonePe/Paytm) & complete payment.\n` +
    `3️⃣ Copy the *12-digit UTR / Transaction ID* from the receipt.\n` +
    `4️⃣ Click the button below to submit your UTR or send \`/utr <12_DIGITS>\`.\n\n` +
    `_VIP will be activated automatically within seconds of UTR submission!_`;

  await ctx.replyWithPhoto(
    { source: qrBuffer },
    {
      caption,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📲 Pay via UPI App', url: upiUrl }],
          [{ text: '✍️ Submit 12-Digit UTR', callback_data: `submit_utr_${planId}` }],
          [{ text: '🔙 Back to Plans', callback_data: 'upgrade_menu' }],
        ],
      },
    }
  );
}

/**
 * Handle UTR Verification
 */
async function handleUtrSubmission(ctx, utr) {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const planId = session.selectedPlan || '24h';

  const checkingMsg = await ctx.reply(
    `🔍 *Verifying Transaction...*\n\n` +
    `UTR: \`${utr}\`\n` +
    `Connecting to ShinzoAuto & Bank Database...`,
    { parse_mode: 'Markdown' }
  );

  // Poll ShinzoAuto database for up to 35 seconds
  const result = await payment.pollAndVerifyUtr(userId, utr, planId, 35000, 3500);

  try {
    await ctx.deleteMessage(checkingMsg.message_id);
  } catch {}

  if (result.success) {
    const expDate = new Date(result.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    await ctx.reply(
      `🎉 *VIP Pass Activated Successfully!*\n\n` +
      `👑 *Plan:* ${result.plan.name}\n` +
      `💰 *Amount Paid:* ₹${result.amount}\n` +
      `📅 *VIP Valid Until:* \`${expDate} IST\`\n\n` +
      `🚀 *Your account is now unlocked with unlimited high-speed downloads!*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 Send TeraBox Link Now', callback_data: 'help_info' }],
            [{ text: '📊 View Status', callback_data: 'check_status' }],
          ],
        },
      }
    );

    // If user had a pending link waiting for quota, process it now!
    if (session.pendingLink) {
      const link = session.pendingLink;
      session.pendingLink = null;
      await ctx.reply(`🔄 *Processing your queued TeraBox link...*`, { parse_mode: 'Markdown' });
      await handleTeraBoxLink(ctx, link);
    }
  } else {
    await ctx.reply(
      `❌ *Verification Failed*\n\n${result.message}\n\n` +
      `*Tips:*\n` +
      `• Verify you transferred the exact amount (₹${config.PLANS[planId].amount}).\n` +
      `• Bank SMS forwarders can take 15-45 seconds to sync.\n` +
      `• Once confirmed, try: \`/utr ${utr}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Re-check UTR', callback_data: `submit_utr_${planId}` }],
            [{ text: '👑 Choose Another Plan', callback_data: 'upgrade_menu' }],
          ],
        },
      }
    );
  }
}

/**
 * Handle incoming TeraBox Link
 */
async function handleTeraBoxLink(ctx, url) {
  const userId = ctx.from.id;
  const quota = await database.checkUserQuota(userId);
  const session = getSession(userId);

  // Check quota
  if (!quota.canDownload) {
    session.pendingLink = url;
    return ctx.reply(
      `⚠️ *Daily Free Limit Reached (2/2 Used)*\n\n` +
      `You have exhausted your 2 free downloads for today.\n\n` +
      `⚡ *Upgrade to VIP Pass to continue downloading instantly!*\n` +
      `• ⚡ *24-Hour Pass:* ₹10\n` +
      `• 👑 *30-Day Monthly:* ₹49\n\n` +
      `_Your link is saved and will be processed immediately after activation._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚡ Get 24-Hour Pass (₹10)', callback_data: 'plan_24h' }],
            [{ text: '👑 Get 30-Day Pass (₹49)', callback_data: 'plan_30d' }],
          ],
        },
      }
    );
  }

  const waitMsg = await ctx.reply(`🔍 *Analyzing TeraBox Link...*\n_Extracting direct streaming & download links..._`, {
    parse_mode: 'Markdown',
  });

  const extractResult = await extractor.extractTeraBox(url);

  try {
    await ctx.deleteMessage(waitMsg.message_id);
  } catch {}

  if (!extractResult.success) {
    return ctx.reply(
      `❌ *Extraction Error*\n\n${extractResult.error || 'Failed to extract file details from this link.'}\n\n` +
      `Please ensure the link is active and not password protected.`,
      { parse_mode: 'Markdown' }
    );
  }

  const files = extractResult.files;
  if (!files || files.length === 0) {
    return ctx.reply('⚠️ No downloadable files found in this share link.');
  }

  // Record quota usage
  await database.recordDownload(userId, files[0]);

  // If single file, deliver directly
  if (files.length === 1) {
    await downloader.deliverFile(ctx, files[0], quota);
  } else {
    // Multi-file folder share
    let folderMsg =
      `📁 *Folder Share Found (${files.length} Files)*\n\n` +
      `Select a file to download or stream:\n\n`;

    const buttons = [];
    files.slice(0, 10).forEach((f, idx) => {
      folderMsg += `${idx + 1}. \`${f.filename}\` (${f.size})\n`;
      buttons.push([
        { text: `📥 ${f.filename.slice(0, 24)}... (${f.size})`, url: f.direct_link || f.download_link },
      ]);
    });

    if (files.length > 10) {
      folderMsg += `\n_...and ${files.length - 10} more files._`;
    }

    await ctx.reply(folderMsg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }
}

/**
 * Send User Status Message
 */
async function sendStatusMessage(ctx) {
  const userId = ctx.from.id;
  const user = (await database.getUser(userId)) || {};
  const quota = await database.checkUserQuota(userId);

  let membershipStr = '';
  if (quota.isVip) {
    const exp = new Date(quota.vipUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    membershipStr = `👑 *VIP Member (Unlimited)*\nExpires: \`${exp} IST\``;
  } else {
    membershipStr = `🆓 *Free Tier*\nDownloads remaining today: *${quota.remainingFree}/${config.FREE_TIER.DAILY_LIMIT}*`;
  }

  const msg =
    `📊 *Your Account Profile*\n\n` +
    `👤 *User:* ${ctx.from.first_name || 'User'} (\`${userId}\`)\n` +
    `🛡️ *Membership:* ${membershipStr}\n` +
    `📦 *Total Downloads:* ${user.total_downloads || 0}\n` +
    `⚡ *Max Upload Size:* ${quota.isVip ? '2GB (VIP)' : '250MB (Free)'}\n\n` +
    `_Upgrade anytime for instant unthrottled access!_`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👑 Upgrade / Extend VIP', callback_data: 'upgrade_menu' }],
        [{ text: '❓ Help', callback_data: 'help_info' }],
      ],
    },
  });
}

/**
 * Send Help Message
 */
async function sendHelpMessage(ctx) {
  const msg =
    `📖 *TeraBox Bot Usage Guide*\n\n` +
    `*How to use:* \n` +
    `1. Just copy and send any TeraBox link to this chat.\n` +
    `2. The bot will extract direct high-speed download & streaming links.\n` +
    `3. Small videos/files (<50MB) are sent directly inside Telegram.\n` +
    `4. Larger files (>50MB up to 2GB) receive instant CDN direct download and online video streaming links.\n\n` +
    `*Supported Domains:*\n` +
    `• \`terabox.com\`, \`teraboxapp.com\`\n` +
    `• \`1024tera.com\`, \`1024terabox.com\`\n` +
    `• \`teraboxshare.com\`, \`teraboxlink.com\`\n` +
    `• \`mirrobox.com\`, \`nephobox.com\`, \`4funbox.com\`\n\n` +
    `*Commands:*\n` +
    `• \`/start\` - Main menu & status\n` +
    `• \`/buy\` - Upgrade to VIP (₹10 / ₹49)\n` +
    `• \`/status\` - Check remaining downloads\n` +
    `• \`/utr <12_digits>\` - Verify UPI transaction`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👑 Upgrade to VIP', callback_data: 'upgrade_menu' }],
        [{ text: '📊 My Status', callback_data: 'check_status' }],
      ],
    },
  });
}

module.exports = {
  createBot,
};
