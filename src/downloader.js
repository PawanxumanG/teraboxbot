const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { formatBytes, isVideoFile } = require('./extractor');

const TEMP_DIR = path.join(os.tmpdir(), 'terabox_bot_downloads');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Generate a visual progress bar string
 * @param {number} percent 0 - 100
 */
function renderProgressBar(percent) {
  const totalBars = 10;
  const filledBars = Math.min(totalBars, Math.max(0, Math.round((percent / 100) * totalBars)));
  const emptyBars = totalBars - filledBars;
  return '█'.repeat(filledBars) + '░'.repeat(emptyBars);
}

/**
 * Download file from TeraBox direct link chunk-by-chunk to temp file
 * @param {string} url 
 * @param {string} filename 
 * @param {number} totalBytes 
 * @param {function} onProgress 
 */
async function downloadToFile(url, filename, totalBytes = 0, onProgress = null) {
  const safeFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = path.join(TEMP_DIR, safeFilename);

  const writer = fs.createWriteStream(filePath);
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 120000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://www.terabox.app/',
    },
  });

  const streamTotal = parseInt(response.headers['content-length'] || totalBytes || 0, 10);
  let downloadedBytes = 0;
  let lastProgressUpdate = 0;

  return new Promise((resolve, reject) => {
    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const now = Date.now();
      // Throttle progress updates to at most once every 2 seconds
      if (onProgress && streamTotal > 0 && now - lastProgressUpdate >= 2000) {
        lastProgressUpdate = now;
        const percent = Math.min(100, Math.round((downloadedBytes / streamTotal) * 100));
        onProgress(downloadedBytes, streamTotal, percent);
      }
    });

    response.data.pipe(writer);

    writer.on('finish', () => {
      if (onProgress && streamTotal > 0) {
        onProgress(downloadedBytes, streamTotal, 100);
      }
      resolve({ filePath, size: downloadedBytes });
    });

    writer.on('error', (err) => {
      // Clean up file on error
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      reject(err);
    });

    response.data.on('error', (err) => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      reject(err);
    });
  });
}

/**
 * Handle streaming and delivery of a TeraBox file to Telegram user
 * @param {object} ctx Telegraf context
 * @param {object} file File metadata
 * @param {object} quota User quota info
 */
async function deliverFile(ctx, file, quota) {
  const filename = file.filename || 'TeraBox_File';
  const sizeBytes = file.size_bytes || 0;
  const sizeFormatted = file.size || formatBytes(sizeBytes);
  const isVideo = isVideoFile(filename);
  const dlink = file.direct_link || file.download_link;

  // Check Free Tier Max File Size (250MB)
  if (!quota.isVip && sizeBytes > config.FREE_TIER.MAX_FILE_SIZE_MB * 1024 * 1024) {
    return ctx.reply(
      `⚠️ *File Size Limit Exceeded*\n\n` +
      `📁 *File:* \`${filename}\`\n` +
      `📦 *Size:* ${sizeFormatted}\n\n` +
      `Free users can download files up to *${config.FREE_TIER.MAX_FILE_SIZE_MB}MB*.\n` +
      `👑 Upgrade to *VIP* to unlock downloads up to *2GB* and unlimited high-speed streams!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👑 Upgrade to VIP (from ₹10)', callback_data: 'upgrade_menu' }],
            [{ text: '📊 Check My Quota', callback_data: 'check_status' }],
          ],
        },
      }
    );
  }

  // Check if file is small enough for direct Telegram upload
  const canDirectUpload = sizeBytes > 0 && sizeBytes <= config.TELEGRAM_MAX_DIRECT_UPLOAD_BYTES;

  if (canDirectUpload) {
    // Direct chunked download + Telegram upload
    const statusMsg = await ctx.reply(
      `📥 *Preparing Download...*\n\n` +
      `📁 *File:* \`${filename}\`\n` +
      `📦 *Size:* ${sizeFormatted}\n` +
      `⚡ *Speed:* High-Speed Direct Stream\n\n` +
      `[░░░░░░░░░░] 0%`,
      { parse_mode: 'Markdown' }
    );

    let downloadedFile = null;
    try {
      downloadedFile = await downloadToFile(dlink, filename, sizeBytes, async (curr, total, percent) => {
        try {
          const bar = renderProgressBar(percent);
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `📥 *Downloading from TeraBox...*\n\n` +
            `📁 *File:* \`${filename}\`\n` +
            `📦 *Size:* ${formatBytes(curr)} / ${formatBytes(total)}\n` +
            `[${bar}] ${percent}%`,
            { parse_mode: 'Markdown' }
          );
        } catch {
          // Ignore message edit throttle errors
        }
      });

      // Update status to uploading
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `📤 *Uploading to Telegram...*\n\n📁 \`${filename}\`\nAlmost done!`,
          { parse_mode: 'Markdown' }
        );
      } catch {}

      const caption =
        `✅ *TeraBox Download Complete!*\n\n` +
        `📁 *File:* \`${filename}\`\n` +
        `📦 *Size:* ${sizeFormatted}\n` +
        `⚡ *Powered by:* @${ctx.botInfo?.username || 'tera_downlaoder_bot'}`;

      if (isVideo) {
        await ctx.replyWithVideo(
          { source: downloadedFile.filePath },
          {
            caption,
            parse_mode: 'Markdown',
            supports_streaming: true,
          }
        );
      } else {
        await ctx.replyWithDocument(
          { source: downloadedFile.filePath, filename },
          { caption, parse_mode: 'Markdown' }
        );
      }

      // Delete status message
      try {
        await ctx.deleteMessage(statusMsg.message_id);
      } catch {}
    } catch (err) {
      console.error('[Downloader] Direct upload error:', err.message);
      // Fallback to providing high-speed direct download link
      await ctx.reply(
        `⚡ *Direct Download Ready!*\n\n` +
        `📁 *File:* \`${filename}\`\n` +
        `📦 *Size:* ${sizeFormatted}\n\n` +
        `Direct Telegram transfer encountered a network timeout. You can download or stream the file directly below without speed limits!`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⚡ Instant Direct Download', url: dlink }],
              ...(file.stream_link ? [[{ text: '▶️ Stream Online / VLC', url: file.stream_link }]] : []),
            ],
          },
        }
      );
    } finally {
      // Clean up temp file
      if (downloadedFile && fs.existsSync(downloadedFile.filePath)) {
        try {
          fs.unlinkSync(downloadedFile.filePath);
        } catch {}
      }
    }
  } else {
    // For large files (>50MB up to 2GB)
    const caption =
      `🎉 *TeraBox File Unlocked!*\n\n` +
      `📁 *Filename:* \`${filename}\`\n` +
      `📦 *Size:* ${sizeFormatted}\n` +
      `⚡ *Download Speed:* Maximum (Unthrottled CDN)\n` +
      `🛡️ *Status:* Ads Bypassed & Direct Link Extracted\n\n` +
      `_Click the button below to download at full speed in your browser, IDM, or ADM!_`;

    await ctx.reply(caption, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ High-Speed Direct Download', url: dlink }],
          ...(isVideo && file.stream_link
            ? [[{ text: '▶️ Watch Video Stream Online', url: file.stream_link }]]
            : []),
          [{ text: '👑 Upgrade to VIP (Unlimited & Faster)', callback_data: 'upgrade_menu' }],
        ],
      },
    });
  }
}

module.exports = {
  renderProgressBar,
  downloadToFile,
  deliverFile,
};
