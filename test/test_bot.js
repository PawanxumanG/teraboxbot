const assert = require('assert');
const config = require('../src/config');
const extractor = require('../src/extractor');
const database = require('../src/database');
const payment = require('../src/payment');
const downloader = require('../src/downloader');

async function runTests() {
  console.log('🧪 Starting TeraBox Bot Test Suite...\n');

  // Test 1: Config Validation
  console.log('Test 1: Config checks');
  assert.ok(config.BOT_TOKEN, 'BOT_TOKEN must be defined');
  assert.strictEqual(config.PLANS['24h'].amount, 10, '24h plan must be ₹10');
  assert.strictEqual(config.PLANS['30d'].amount, 49, '30d plan must be ₹49');
  assert.strictEqual(config.FREE_TIER.DAILY_LIMIT, 2, 'Free tier limit must be 2');
  console.log('✅ Config validation passed!\n');

  // Test 2: URL & Domain Extraction
  console.log('Test 2: TeraBox Domain & URL Validation');
  const validUrls = [
    'https://terabox.com/s/1a2b3c4d',
    'https://teraboxapp.com/s/1xyz987',
    'https://1024tera.com/sharing/link?surl=abc1234',
    'https://www.mirrobox.com/s/1qwerty',
    'https://teraboxlink.com/s/1sample',
  ];

  for (const u of validUrls) {
    assert.strictEqual(extractor.isValidTeraBoxUrl(u), true, `Failed on valid URL: ${u}`);
  }

  assert.strictEqual(extractor.isValidTeraBoxUrl('https://google.com/test'), false);
  assert.strictEqual(extractor.isValidTeraBoxUrl('https://youtube.com/watch?v=123'), false);
  console.log('✅ URL validation passed!\n');

  // Test 3: Short Code Extraction
  console.log('Test 3: Short Code Extraction');
  assert.strictEqual(extractor.extractShortCode('https://terabox.com/s/1a2b3c4d'), 'a2b3c4d');
  assert.strictEqual(extractor.extractShortCode('https://1024tera.com/sharing/link?surl=abc1234'), 'abc1234');
  console.log('✅ Short code extraction passed!\n');

  // Test 4: Formatters & Progress Bar
  console.log('Test 4: Formatters & Progress Bar');
  assert.strictEqual(extractor.formatBytes(1024), '1.00 KB');
  assert.strictEqual(extractor.formatBytes(1024 * 1024 * 50), '50.00 MB');
  assert.strictEqual(extractor.formatBytes(1024 * 1024 * 1024 * 1.5), '1.50 GB');

  const bar50 = downloader.renderProgressBar(50);
  assert.strictEqual(bar50, '█████░░░░░', '50% progress bar must have 5 filled blocks');
  console.log('✅ Formatters & progress bar passed!\n');

  // Test 5: UPI Deep-link & QR Code Generation
  console.log('Test 5: UPI Intent & QR Code');
  const upiUrl = payment.generateUpiUrl('999999', '24h');
  assert.ok(upiUrl.includes('pa=pawanponnam@okicici'), 'UPI URL must contain VPA');
  assert.ok(upiUrl.includes('am=10.00'), 'UPI URL must contain amount 10.00');

  const qrBuf = await payment.generateQrBuffer(upiUrl);
  assert.ok(Buffer.isBuffer(qrBuf), 'QR generator must return Buffer');
  assert.ok(qrBuf.length > 500, 'QR buffer must be valid PNG size');
  console.log('✅ UPI & QR Code generation passed!\n');

  // Test 6: Database & Firebase Connectivity
  console.log('Test 6: Database Connectivity & Quota Engine');
  const quota = await database.checkUserQuota(9999999999);
  assert.strictEqual(typeof quota.canDownload, 'boolean', 'Quota canDownload must be boolean');
  assert.strictEqual(quota.remainingFree, 2, 'Default free quota must be 2');
  console.log('✅ Database & Quota engine passed!\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! 🚀');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
