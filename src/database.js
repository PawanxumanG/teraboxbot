const axios = require('axios');
const config = require('./config');

const DB_URL = config.FIREBASE_DB_URL;

/**
 * Format today's date as YYYY-MM-DD in UTC
 */
function getTodayDateString() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

/**
 * Fetch a user profile from Firebase RTDB
 * @param {string|number} userId 
 */
async function getUser(userId) {
  try {
    const res = await axios.get(`${DB_URL}/terabox_users/${userId}.json`);
    return res.data || null;
  } catch (error) {
    console.error(`[DB] Error fetching user ${userId}:`, error.message);
    return null;
  }
}

/**
 * Initialize or update a user record
 * @param {string|number} userId 
 * @param {object} userInfo 
 */
async function initUser(userId, userInfo = {}) {
  try {
    let existing = await getUser(userId);
    const now = Date.now();
    const today = getTodayDateString();

    if (!existing) {
      existing = {
        user_id: userId,
        username: userInfo.username || '',
        first_name: userInfo.first_name || '',
        last_name: userInfo.last_name || '',
        created_at: now,
        vip_until: 0,
        daily_downloads: {
          date: today,
          count: 0,
        },
        total_downloads: 0,
      };
      await axios.put(`${DB_URL}/terabox_users/${userId}.json`, existing);
    } else {
      // Update profile fields if changed
      const updates = {};
      if (userInfo.username && existing.username !== userInfo.username) updates.username = userInfo.username;
      if (userInfo.first_name && existing.first_name !== userInfo.first_name) updates.first_name = userInfo.first_name;
      if (userInfo.last_name && existing.last_name !== userInfo.last_name) updates.last_name = userInfo.last_name;
      
      if (Object.keys(updates).length > 0) {
        await axios.patch(`${DB_URL}/terabox_users/${userId}.json`, updates);
        existing = { ...existing, ...updates };
      }
    }

    return existing;
  } catch (error) {
    console.error(`[DB] Error initializing user ${userId}:`, error.message);
    return null;
  }
}

/**
 * Check a user's quota and VIP status
 * @param {string|number} userId 
 */
async function checkUserQuota(userId) {
  const user = await getUser(userId);
  const now = Date.now();
  const today = getTodayDateString();

  if (!user) {
    return {
      isVip: false,
      canDownload: true,
      remainingFree: config.FREE_TIER.DAILY_LIMIT,
      vipUntil: 0,
      maxSizeMb: config.FREE_TIER.MAX_FILE_SIZE_MB,
    };
  }

  // Check VIP status
  const isVip = Boolean(user.vip_until && user.vip_until > now);

  if (isVip) {
    return {
      isVip: true,
      canDownload: true,
      remainingFree: Infinity,
      vipUntil: user.vip_until,
      maxSizeMb: 2048, // 2GB for VIP
    };
  }

  // Free Tier check
  let daily = user.daily_downloads || { date: today, count: 0 };
  if (daily.date !== today) {
    daily = { date: today, count: 0 };
  }

  const freeLimit = config.FREE_TIER.DAILY_LIMIT;
  const used = daily.count || 0;
  const remaining = Math.max(0, freeLimit - used);
  const canDownload = remaining > 0;

  return {
    isVip: false,
    canDownload,
    remainingFree: remaining,
    vipUntil: 0,
    maxSizeMb: config.FREE_TIER.MAX_FILE_SIZE_MB,
    reason: canDownload ? null : 'quota_exceeded',
  };
}

/**
 * Record a successful download for user
 * @param {string|number} userId 
 * @param {object} fileInfo 
 */
async function recordDownload(userId, fileInfo = {}) {
  try {
    const user = (await getUser(userId)) || {};
    const today = getTodayDateString();
    let daily = user.daily_downloads || { date: today, count: 0 };

    if (daily.date !== today) {
      daily = { date: today, count: 0 };
    }

    daily.count = (daily.count || 0) + 1;
    const totalDownloads = (user.total_downloads || 0) + 1;

    await axios.patch(`${DB_URL}/terabox_users/${userId}.json`, {
      daily_downloads: daily,
      total_downloads: totalDownloads,
      last_download: {
        filename: fileInfo.filename || 'unknown',
        size: fileInfo.size || 'unknown',
        timestamp: Date.now(),
      },
    });

    return true;
  } catch (error) {
    console.error(`[DB] Error recording download for ${userId}:`, error.message);
    return false;
  }
}

/**
 * Verify UTR from bank_verified_transactions and activate VIP
 * @param {string|number} userId 
 * @param {string} utr 
 * @param {string} planId 
 */
async function verifyAndRedeemUtr(userId, utr, planId = '24h') {
  const cleanUtr = String(utr).trim();
  const plan = config.PLANS[planId];
  if (!plan) {
    return { success: false, message: 'Invalid plan selected.' };
  }

  try {
    // 1. Check if UTR is already redeemed in TeraBox Bot
    const usedRes = await axios.get(`${DB_URL}/terabox_used_utrs/${cleanUtr}.json`);
    if (usedRes.data) {
      return {
        success: false,
        message: '⚠️ This UTR has already been redeemed and cannot be used again.',
      };
    }

    // 2. Query bank_verified_transactions
    const txRes = await axios.get(`${DB_URL}/bank_verified_transactions/${cleanUtr}.json`);
    const tx = txRes.data;

    if (!tx) {
      return {
        success: false,
        notFound: true,
        message: '⏳ Transaction not found yet. It may take 15-45 seconds for your bank SMS to sync with ShinzoAuto.',
      };
    }

    // 3. Check if marked used directly in transaction record
    if (tx.used === true) {
      return {
        success: false,
        message: '⚠️ This transaction has already been redeemed for another service.',
      };
    }

    // 4. Check if paid amount meets plan requirement
    const paidAmount = parseFloat(tx.amount || 0);
    if (paidAmount < plan.amount) {
      return {
        success: false,
        message: `⚠️ Insufficient payment amount: Received ₹${paidAmount}, but ₹${plan.amount} is required for ${plan.name}.`,
      };
    }

    // 5. Mark UTR as used
    const now = Date.now();
    await Promise.all([
      axios.patch(`${DB_URL}/bank_verified_transactions/${cleanUtr}.json`, {
        used: true,
        used_by: userId,
        used_at: now,
        service: 'terabox_bot',
        plan: planId,
      }),
      axios.put(`${DB_URL}/terabox_used_utrs/${cleanUtr}.json`, {
        utr: cleanUtr,
        user_id: userId,
        plan_id: planId,
        amount: paidAmount,
        redeemed_at: now,
      }),
    ]);

    // 6. Calculate new VIP expiry
    const user = (await getUser(userId)) || {};
    const currentVipUntil = user.vip_until || 0;
    const baseTime = currentVipUntil > now ? currentVipUntil : now;
    const newVipUntil = baseTime + plan.durationMs;

    // 7. Update user VIP record
    await axios.patch(`${DB_URL}/terabox_users/${userId}.json`, {
      vip_until: newVipUntil,
      last_vip_plan: planId,
      last_payment: {
        utr: cleanUtr,
        amount: paidAmount,
        timestamp: now,
      },
    });

    // 8. Record in redemption history
    await axios.put(`${DB_URL}/terabox_redemptions/${cleanUtr}.json`, {
      utr: cleanUtr,
      user_id: userId,
      plan: planId,
      amount: paidAmount,
      timestamp: now,
      vip_until: newVipUntil,
    });

    return {
      success: true,
      plan,
      vipUntil: newVipUntil,
      amount: paidAmount,
    };
  } catch (error) {
    console.error(`[DB] Error verifying UTR ${cleanUtr}:`, error.message);
    return {
      success: false,
      message: `Error verifying transaction: ${error.message}`,
    };
  }
}

/**
 * Manually grant VIP access to a user (Admin only)
 * @param {string|number} userId 
 * @param {number} days 
 */
async function manualGrantVip(userId, days = 30) {
  try {
    const now = Date.now();
    const durationMs = days * 24 * 60 * 60 * 1000;
    const user = (await getUser(userId)) || {};
    const currentVip = user.vip_until || 0;
    const base = currentVip > now ? currentVip : now;
    const newVipUntil = base + durationMs;

    await axios.patch(`${DB_URL}/terabox_users/${userId}.json`, {
      vip_until: newVipUntil,
      manually_granted_by_admin: true,
      last_granted_at: now,
    });

    return { success: true, vipUntil: newVipUntil };
  } catch (error) {
    console.error(`[DB] Error granting VIP to ${userId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Manually revoke VIP access (Admin only)
 * @param {string|number} userId 
 */
async function manualRevokeVip(userId) {
  try {
    await axios.patch(`${DB_URL}/terabox_users/${userId}.json`, {
      vip_until: 0,
      revoked_by_admin: true,
      revoked_at: Date.now(),
    });
    return { success: true };
  } catch (error) {
    console.error(`[DB] Error revoking VIP for ${userId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch Admin Statistics
 */
async function getAdminStats() {
  try {
    const [usersRes, redemptionsRes] = await Promise.all([
      axios.get(`${DB_URL}/terabox_users.json?shallow=true`).catch(() => ({ data: {} })),
      axios.get(`${DB_URL}/terabox_redemptions.json`).catch(() => ({ data: {} })),
    ]);

    const totalUsers = Object.keys(usersRes.data || {}).length;
    const redemptions = redemptionsRes.data || {};
    let totalRevenue = 0;
    let totalRedemptions = 0;

    for (const key of Object.keys(redemptions)) {
      const item = redemptions[key];
      if (item && item.amount) {
        totalRevenue += parseFloat(item.amount);
        totalRedemptions++;
      }
    }

    return {
      totalUsers,
      totalRedemptions,
      totalRevenue,
    };
  } catch (error) {
    console.error('[DB] Error getting admin stats:', error.message);
    return { totalUsers: 0, totalRedemptions: 0, totalRevenue: 0 };
  }
}

/**
 * Get all user IDs (for admin announcements)
 */
async function getAllUserIds() {
  try {
    const res = await axios.get(`${DB_URL}/terabox_users.json?shallow=true`);
    return Object.keys(res.data || {});
  } catch (error) {
    console.error('[DB] Error getting all user IDs:', error.message);
    return [];
  }
}

module.exports = {
  getUser,
  initUser,
  checkUserQuota,
  recordDownload,
  verifyAndRedeemUtr,
  manualGrantVip,
  manualRevokeVip,
  getAdminStats,
  getAllUserIds,
};
