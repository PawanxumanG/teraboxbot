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

  // Global error handler
  bot.catch((err, ctx) => {
    console.error(`[Telegraf Error] for ${ctx.updateType}:`, err);
  });

  // Middleware: Register / Update user in Firebase on every message
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      console.log(`[Bot] Incoming update ${ctx.updateType} from @${ctx.from.username || ctx.from.id}`);
      try {
        await database.initUser(ctx.from.id, {
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
        });
      } catch (e) {
        console.warn('[Bot Middleware] initUser error (continuing):', e.message);
      }
    }
    return next();
  });

  // /start command
  bot.start(async (ctx) => {
    console.log(`[Bot] /start received from user ${ctx.from ? ctx.from.id : 'unknown'}`);
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
      `👋 *Welcome to TeraBox, DiskWala & Flezen Downloader*, ${name}!\n\n` +
      `Send any supported link to instantly get direct high-speed video streams and downloads — bypassing app requirements, speed caps, and ads!\n\n` +
      `📊 *Your Account Status:*\n${statusText}\n\n` +
      `👇 *Send a link or choose an option below:*`;

    await ctx.reply(welcomeMsg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚡ 24h Pass (₹10)', callback_data: 'plan_24h' },
            { text: '📦 10-Day Pass (₹29)', callback_data: 'plan_10d' },
          ],
          [
            { text: '👑 30-Day Pass (₹49)', callback_data: 'plan_30d' },
            { text: '🌟 90-Day VIP (₹139)', callback_data: 'plan_90d' },
          ],
          [
            { text: '🌐 Supported Domains', callback_data: 'show_domains' },
            { text: '📊 My Account Status', callback_data: 'check_status' },
          ],
        ],
      },
    });
  });

  // /domains command
  bot.command('domains', async (ctx) => {
    await sendDomainsMessage(ctx);
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

  bot.action('show_domains', async (ctx) => {
    await ctx.answerCbQuery();
    await sendDomainsMessage(ctx);
  });

  // Dynamic VIP plan selection
  bot.action(/^plan_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planId = ctx.match[1];
    if (config.PLANS[planId]) {
      await handlePlanSelected(ctx, planId);
    }
  });

  bot.action(/^submit_utr_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const planId = ctx.match[1];
    const session = getSession(ctx.from.id);
    session.selectedPlan = planId;
    session.awaitingUtr = true;

    await ctx.reply(
      `✍️ *Submit 12-Digit UTR for ${config.PLANS[planId]?.name || 'VIP'}:*\n\n` +
      `Please reply with your *12-digit UTR / UPI Transaction Reference Number* (or send \`/utr <number>\`).`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
        },
      }
    );
  });

  // Message Handler: Links, Captions, and UTR inputs
  bot.on(['text', 'caption'], async (ctx) => {
    const text = (ctx.message.text || ctx.message.caption || '').trim();
    if (!text) return;
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

    // 2. Extract any URL from text or caption
    const urls = extractor.extractUrlsFromText(text);
    if (urls.length > 0) {
      return handleTeraBoxLink(ctx, urls[0]);
    }

    // 3. Fallback check for bare shortcodes or supported links without scheme
    if (extractor.isValidTeraBoxUrl(text) || text.startsWith('terabox.com') || text.startsWith('1024tera.com') || text.startsWith('diskwala') || text.startsWith('flezen')) {
      const fullUrl = text.startsWith('http') ? text : `https://${text}`;
      return handleTeraBoxLink(ctx, fullUrl);
    }

    // Default response for non-URL messages
    await ctx.reply(
      `🤖 *Send me any supported link to download or stream!*\n\n` +
      `⚡ *Supported Services:*\n` +
      `• 📦 *TeraBox Mirrors:* \`terabox.com\`, \`1024tera.com\`, \`mirrobox.com\`, \`nephobox.com\`, etc.\n` +
      `• ⚡ *DiskWala:* \`diskwala.com\`, \`disk.diskwala.com\`, \`diskwala.in\`\n` +
      `• 🚀 *Flezen:* \`flezen.com\`, \`flezen.org\`, \`flezen.cc\`\n` +
      `• 🔗 *Shortlinks:* \`nowplaytoc.com\`, \`hugeboxlightning.com\`, \`cashsnap.com\`, etc.\n\n` +
      `_Send \`/domains\` to view the full list of 30+ supported domains._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 View All Supported Domains', callback_data: 'show_domains' }],
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
    `👑 *Choose Your VIP Subscription Pass*\n\n` +
    `⚡ *24-Hour Instant Pass: ₹10*\n` +
    `• Unlimited downloads & 1080p stream for 24h\n\n` +
    `📦 *10-Day VIP Pass: ₹29*\n` +
    `• Superfast download, 0 daily limit & folder support\n\n` +
    `👑 *30-Day Monthly Pass: ₹49*\n` +
    `• Unlimited downloads up to 2GB, priority processing\n\n` +
    `🌟 *90-Day VIP Pass: ₹139*\n` +
    `• 3 months unthrottled downloads & zero queue\n\n` +
    `💎 *1-Year VIP Pass: ₹349*\n` +
    `• Full year unlimited access with maximum bandwidth\n\n` +
    `👇 *Select a plan to pay instantly via UPI QR:*`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 24 Hours (₹10)', callback_data: 'plan_24h' },
          { text: '📦 10 Days (₹29)', callback_data: 'plan_10d' },
        ],
        [
          { text: '👑 30 Days (₹49)', callback_data: 'plan_30d' },
          { text: '🌟 90 Days (₹139)', callback_data: 'plan_90d' },
        ],
        [
          { text: '💎 1 Year Pass (₹349)', callback_data: 'plan_365d' },
        ],
        [
          { text: '🌐 Supported Domains', callback_data: 'show_domains' },
          { text: '📊 My Account Status', callback_data: 'check_status' },
        ],
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
    files.slice(0, 8).forEach((f, idx) => {
      folderMsg += `${idx + 1}. \`${f.filename}\` (${f.size})\n`;
      const targetUrl =
        f.direct_link ||
        f.download_link ||
        `https://1024terabox.com/s/1${extractResult.surl}?fid=${f.fs_id}`;
      buttons.push([
        { text: `📥 ${f.filename.slice(0, 22)}... (${f.size})`, url: targetUrl },
      ]);
    });

    if (files.length > 8) {
      folderMsg += `\n_...and ${files.length - 8} more files in this folder._\n`;
    }

    buttons.push([
      {
        text: '📂 Open Complete Shared Folder',
        url: `https://1024terabox.com/s/1${extractResult.surl}`,
      },
    ]);

    const firstThumb = files.find((f) => f.thumbnail)?.thumbnail;
    if (firstThumb) {
      try {
        await ctx.replyWithPhoto(firstThumb, {
          caption: folderMsg,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons },
        });
        return;
      } catch {}
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
 * Send Supported Domains Message
 */
async function sendDomainsMessage(ctx) {
  const msg =
    `🌐 *All Supported Links & Domains*\n\n` +
    `📦 *TeraBox & Official Mirrors (24+ Domains):*\n` +
    `• \`terabox.com\`, \`teraboxapp.com\`\n` +
    `• \`1024tera.com\`, \`1024terabox.com\`\n` +
    `• \`teraboxshare.com\`, \`teraboxlink.com\`\n` +
    `• \`mirrobox.com\`, \`nephobox.com\`, \`4funbox.com\`\n` +
    `• \`freeterabox.com\`, \`momerybox.com\`, \`tibibox.com\`\n` +
    `• \`gibibox.com\`, \`terabox.fun\`, \`terasharelink.com\`\n` +
    `• \`terafileshare.com\`, \`teraboxurl.com\`, \`dubox.com\`\n` +
    `• \`terabox.me\`, \`terabox.app\`, \`box.guide\`\n\n` +
    `⚡ *DiskWala Domains:*\n` +
    `• \`diskwala.com\`, \`disk.diskwala.com\`\n` +
    `• \`diskwala.in\`, \`diskwala.tech\`, \`diskwala.online\`\n` +
    `• \`diskwala.link\`, \`disk.media\`\n\n` +
    `🚀 *Flezen Domains:*\n` +
    `• \`flezen.com\`, \`flezen.org\`, \`flezen.cc\`\n` +
    `• \`flezen.xyz\`, \`flezen.in\`, \`flezen.app\`\n\n` +
    `🔗 *Affiliate Shortlinks & Redirectors:*\n` +
    `• \`nowplaytoc.com\`, \`nowplaylee.com\`, \`nowplaygo.com\`\n` +
    `• \`hugeboxlightning.com\`, \`hugeboxstack.com\`\n` +
    `• \`cashsnap.com\`, \`cashsnap.in\`, \`yt1s.click\`\n` +
    `• \`bit.ly\`, \`tinyurl.com\`, and all direct shortlinks\n\n` +
    `✨ *Simply copy and send any link from these services into the chat!*`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👑 Upgrade to VIP', callback_data: 'upgrade_menu' }],
        [{ text: '📊 Check My Quota', callback_data: 'check_status' }],
      ],
    },
  });
}

/**
 * Send Help Message
 */
async function sendHelpMessage(ctx) {
  const msg =
    `📖 *TeraBox, DiskWala & Flezen Bot Usage Guide*\n\n` +
    `*How to use:* \n` +
    `1. Just copy and send any supported link to this chat.\n` +
    `2. The bot extracts direct high-speed download & streaming links instantly.\n` +
    `3. Small videos/files (<50MB) are delivered directly inside Telegram.\n` +
    `4. Large videos/files receive ultra-fast CDN download & streaming players.\n\n` +
    `*Commands:*\n` +
    `• \`/start\` - Main menu & status\n` +
    `• \`/domains\` - View all 30+ supported domains\n` +
    `• \`/buy\` - View VIP plans & packages\n` +
    `• \`/status\` - Check remaining downloads\n` +
    `• \`/utr <12_digits>\` - Verify UPI transaction`;

  await ctx.reply(msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌐 View All Supported Domains', callback_data: 'show_domains' }],
        [{ text: '👑 Upgrade to VIP', callback_data: 'upgrade_menu' }],
        [{ text: '📊 My Status', callback_data: 'check_status' }],
      ],
    },
  });
}

module.exports = {
  createBot,
};
