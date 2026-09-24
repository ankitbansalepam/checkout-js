import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Records a narrated end-to-end guest checkout paid with Shop Pay:
// product -> cart -> checkout (email, shipping) -> Shop Pay in payment methods ->
// Shop Pay popup (completed manually) -> in-app order confirmation.
//
// Narration uses Windows text-to-speech (System.Speech). The final MP4 needs ffmpeg:
// set FFMPEG_PATH, or have `ffmpeg` on PATH. Without it the raw .webm files are kept.
const storeUrl = (process.env.SHOP_PAY_DEMO_STORE_URL || 'https://shoppaystore.mybigcommerce.com').replace(/\/$/, '');
const productId = process.env.SHOP_PAY_DEMO_PRODUCT_ID || '94';
const email = process.env.SHOP_PAY_DEMO_EMAIL || 'demo.shopper@example.com';
const voice = process.env.SHOP_PAY_DEMO_VOICE || 'Microsoft Zira Desktop';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const popupTimeoutMs = Number(process.env.SHOP_PAY_DEMO_POPUP_TIMEOUT_MS || 5 * 60 * 1000);
const address = {
    firstName: 'Demo',
    lastName: 'Shopper',
    address1: '100 Main St',
    city: 'Columbus',
    countryCode: 'US',
    provinceCode: 'OH',
    postCode: '43215',
    phone: '5555555555',
};
const steps = {
    cart: {
        caption: '1. Product added to the BigCommerce cart',
        say: 'In this demo, a shopper adds a product to their cart on a BigCommerce store.',
    },
    checkout: {
        caption: '2. BigCommerce custom checkout (checkout-js)',
        say: 'They continue to the BigCommerce custom checkout, built on checkout J S.',
    },
    email: {
        caption: '3. Guest enters their email',
        say: 'Checking out as a guest, the shopper enters their email address.',
    },
    shipping: {
        caption: '4. Shipping address entered during checkout',
        say: 'Next, they enter their shipping address.',
    },
    shippingMethod: {
        caption: '5. Shipping method selected',
        say: 'A shipping method is selected, and BigCommerce calculates the order total.',
    },
    shopPay: {
        caption: '6. Shop Pay is offered in the payment methods',
        say: 'Because the addresses were entered during checkout, Shop Pay is offered in the payment step, alongside the other payment methods.',
    },
    popup: {
        caption: '7. Shop Pay popup: shopper confirms delivery and pays',
        say: 'Clicking Shop Pay opens the Shop Pay window. The shopper signs in, reviews their shipping address and delivery method, and pays with their saved card.',
    },
    confirmation: {
        caption: '8. Order created in BigCommerce - in-app order confirmation',
        say: 'Once Shopify confirms the payment, our backend creates the order in BigCommerce, and the shopper sees the order confirmation without leaving checkout.',
    },
};
const outputDir = path.resolve('packages/test-framework/videos/shop-pay-demo');
const narrationDir = path.join(outputDir, 'narration');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

fs.mkdirSync(narrationDir, { recursive: true });

function wavDurationSeconds(file) {
    const buffer = fs.readFileSync(file);
    let byteRate = 0;

    for (let offset = 12; offset + 8 <= buffer.length; ) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);

        if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
        if (id === 'data') return size / byteRate;
        offset += 8 + size + (size % 2);
    }

    throw new Error(`Unable to read WAV duration of ${file}`);
}

function synthesize(key, text) {
    const file = path.join(narrationDir, `${key}.wav`);
    const result = spawnSync(
        'powershell',
        [
            '-NoProfile',
            '-Command',
            'Add-Type -AssemblyName System.Speech; ' +
                '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
                '$s.SelectVoice($env:DEMO_VOICE); $s.Rate = 0; ' +
                '$s.SetOutputToWaveFile($env:DEMO_FILE); $s.Speak($env:DEMO_TEXT); $s.Dispose()',
        ],
        { env: { ...process.env, DEMO_VOICE: voice, DEMO_FILE: file, DEMO_TEXT: text }, encoding: 'utf8' },
    );

    if (result.status !== 0) {
        throw new Error(`Text-to-speech failed for "${key}": ${result.stderr}`);
    }

    return { file, duration: wavDurationSeconds(file) };
}

console.log('Generating narration...');
for (const [key, step] of Object.entries(steps)) {
    Object.assign(step, synthesize(key, step.say));
}

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
const startedAt = Date.now();
const elapsed = () => (Date.now() - startedAt) / 1000;
const timeline = [];
let popup;
let popupOpenedAt;
let popupClosedAt;

// Shows the step caption and holds it for as long as its narration plays.
const showStep = async (key, { wait = true } = {}) => {
    const step = steps[key];

    console.log(`> ${step.caption}`);
    timeline.push({ key, at: elapsed() });
    await page
        .evaluate((value) => {
            let banner = document.getElementById('shop-pay-demo-caption');

            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'shop-pay-demo-caption';
                banner.style.cssText =
                    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
                    'background:#5a31f4;color:#fff;font:600 18px/1.4 system-ui,sans-serif;' +
                    'padding:12px 24px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none';
                document.body.appendChild(banner);
            }

            banner.textContent = value;
        }, step.caption)
        .catch(() => undefined);

    if (wait) {
        await page.waitForTimeout(Math.ceil((step.duration + 0.6) * 1000));
    }
};
const field = (testId) => page.locator(`[data-test="${testId}"]`);

try {
    await page.goto(`${storeUrl}/cart.php?action=add&product_id=${productId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await showStep('cart');

    await page.goto(`${storeUrl}/checkout`, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').waitFor({ state: 'visible', timeout: 60000 });
    await showStep('checkout');

    await page.locator('#email').fill(email);
    await showStep('email');
    await page.locator('#checkout-customer-continue').click();

    await field('firstNameInput-text').waitFor({ state: 'visible', timeout: 60000 });
    await showStep('shipping', { wait: false });
    const shippingNarrationEndsAt = Date.now() + steps.shipping.duration * 1000;

    // Country and state first: changing the country re-renders the form and clears other fields.
    await field('countryCodeInput-select').selectOption(address.countryCode);
    await field('provinceCodeInput-select').selectOption(address.provinceCode);
    await page.waitForTimeout(1000);
    await field('firstNameInput-text').fill(address.firstName);
    await field('lastNameInput-text').fill(address.lastName);
    await field('phoneInput-text').fill(address.phone).catch(() => undefined);
    await field('addressLine1Input-text').fill(address.address1);
    await field('cityInput-text').fill(address.city);
    await field('postCodeInput-text').fill(address.postCode);
    await field('postCodeInput-text').blur();

    const sameAsBilling = page.locator('input[name="billingSameAsShipping"]');

    if ((await sameAsBilling.count()) && !(await sameAsBilling.isChecked())) {
        // The input is visually hidden behind a styled label.
        await page.locator('label[for="sameAsBilling"]').click();
    }
    await page.waitForTimeout(Math.max(0, shippingNarrationEndsAt - Date.now()));

    // BigCommerce ticks the radio only after the selection round-trips to the server.
    const shippingOptions = page.locator('.form-checklist-item input[type="radio"]');

    await shippingOptions.first().waitFor({ state: 'attached', timeout: 60000 });
    if ((await page.locator('.form-checklist-item input[type="radio"]:checked').count()) === 0) {
        await shippingOptions.first().click({ force: true });
    }
    await page.locator('.form-checklist-item input[type="radio"]:checked').waitFor({ state: 'attached', timeout: 30000 });
    await page.locator('#checkout-shipping-continue').waitFor({ state: 'visible' });
    await showStep('shippingMethod');
    await page.locator('#checkout-shipping-continue').click();

    const shopPayButton = page.getByRole('button', { name: /Shop Pay/i }).first();

    await shopPayButton.waitFor({ state: 'visible', timeout: 60000 });
    await shopPayButton.scrollIntoViewIfNeeded();
    await showStep('shopPay');

    const popupPromise = context.waitForEvent('page', { timeout: 60000 });

    await shopPayButton.click();
    popup = await popupPromise;
    popupOpenedAt = elapsed();
    popup.on('close', () => {
        popupClosedAt ??= elapsed();
    });
    timeline.push({ key: 'popup', at: popupOpenedAt });

    console.log(`Complete the Shop Pay popup manually (up to ${popupTimeoutMs / 60000} minutes).`);

    await page.waitForURL(/shopPay=1/, { timeout: popupTimeoutMs });
    popupClosedAt ??= elapsed();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await showStep('confirmation');
    await page.waitForTimeout(3000);

    if (!popup.isClosed()) {
        await popup.close();
    }
} finally {
    await context.close();
    await browser.close();
}

const pageVideo = await page.video()?.path();
const popupVideo = popup ? await popup.video()?.path() : undefined;
const timelineFile = path.join(outputDir, 'timeline.json');

fs.writeFileSync(
    timelineFile,
    JSON.stringify({ pageVideo, popupVideo, popupOpenedAt, popupClosedAt, timeline }, null, 2),
);
console.log(`Raw videos and timeline saved under ${outputDir}`);

// Compose one MP4: the checkout page, cut to the Shop Pay popup while it is open,
// with each narration clip placed at the moment its step started.
const clips = timeline.map(({ key, at }) => ({ file: steps[key].file, at }));
const inputs = ['-y', '-i', pageVideo];
const filters = [];
let videoOut = '0:v';

if (popupVideo && popupOpenedAt !== undefined) {
    const end = popupClosedAt ?? popupOpenedAt + popupTimeoutMs / 1000;

    inputs.push('-i', popupVideo);
    filters.push(
        `[1:v]setpts=PTS-STARTPTS+${popupOpenedAt.toFixed(3)}/TB[pop]`,
        `[0:v][pop]overlay=eof_action=pass:enable='between(t,${popupOpenedAt.toFixed(3)},${end.toFixed(3)})'[v]`,
    );
    videoOut = '[v]';
}

const audioOffset = inputs.filter((value) => value === '-i').length;

clips.forEach(({ file, at }, index) => {
    const delay = Math.round(at * 1000);

    inputs.push('-i', file);
    filters.push(`[${audioOffset + index}:a]adelay=${delay}|${delay}[a${index}]`);
});
filters.push(
    `${clips.map((_, index) => `[a${index}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest[a]`,
);

const outputFile = path.join(outputDir, 'shop-pay-demo.mp4');
const result = spawnSync(
    ffmpegPath,
    [
        ...inputs,
        '-filter_complex',
        filters.join(';'),
        '-map',
        videoOut,
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'medium',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-shortest',
        outputFile,
    ],
    { encoding: 'utf8' },
);

if (result.error || result.status !== 0) {
    console.error(`ffmpeg failed; raw .webm files are kept.\n${result.error?.message || result.stderr.slice(-2000)}`);
    process.exitCode = 1;
} else {
    console.log(`Narrated demo saved to ${outputFile}`);
}
