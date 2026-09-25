const QRCode = require('qrcode');
const config = require('./config');
const database = require('./database');

/**
 * Generate UPI deep-link URL
 * @param {string|number} userId 
 * @param {string} planId 
 */
function generateUpiUrl(userId, planId) {
  const plan = config.PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const vpa = config.UPI.VPA;
  const name = encodeURIComponent(config.UPI.NAME);
  const amount = plan.amount.toFixed(2);
  const note = encodeURIComponent(`USER_${userId}_${plan.id}`);

  return `upi://pay?pa=${vpa}&pn=${name}&am=${amount}&cu=INR&tn=${note}`;
}

/**
 * Generate a PNG Buffer for a QR code
 * @param {string} text 
 */
async function generateQrBuffer(text) {
  return QRCode.toBuffer(text, {
    width: 480,
    margin: 2,
    color: {
      dark: '#111827',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'H',
  });
}

/**
 * Periodically poll Firebase for UTR presence (handles ShinzoAuto forwarder delay)
 * @param {string|number} userId 
 * @param {string} utr 
 * @param {string} planId 
 * @param {number} maxWaitMs 
 * @param {number} intervalMs 
 */
async function pollAndVerifyUtr(userId, utr, planId, maxWaitMs = 40000, intervalMs = 4000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await database.verifyAndRedeemUtr(userId, utr, planId);
    if (result.success) {
      return result;
    }
    // If error is not 'notFound', stop polling immediately (e.g. already used or wrong amount)
    if (!result.notFound) {
      return result;
    }
    // Wait interval
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    success: false,
    notFound: true,
    message: '⏳ Transaction not synced yet. Please wait a minute and submit again with /utr ' + utr,
  };
}

module.exports = {
  generateUpiUrl,
  generateQrBuffer,
  pollAndVerifyUtr,
};
