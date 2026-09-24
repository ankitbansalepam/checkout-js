import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const demoUrl = process.env.SHOP_PAY_DEMO_URL || 'https://integrateshoppay.mybigcommerce.com/checkout';
const outputDir = path.resolve('packages/test-framework/videos/shop-pay-demo');
const waitMs = Number(process.env.SHOP_PAY_DEMO_WAIT_MS || 30000);
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
    headless: false,
    slowMo: 250,
    ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
    recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
    viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

await page.goto(demoUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => undefined);

const shopPayButton = page.getByRole('button', { name: /Shop Pay/i }).first();
await shopPayButton.waitFor({ state: 'visible', timeout: 30000 });
await shopPayButton.click();

console.log(`Shop Pay demo recording started: ${demoUrl}`);
console.log(`Complete the Shop Pay popup manually within ${waitMs / 1000} seconds.`);
await page.waitForTimeout(waitMs);

await context.close();
await browser.close();
console.log(`Video saved under ${outputDir}`);
