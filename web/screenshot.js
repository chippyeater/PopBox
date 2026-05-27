#!/usr/bin/env node
/**
 * 用法:
 *   node screenshot.js [url] [outfile] [selector_to_click]
 *
 * 例:
 *   node screenshot.js http://localhost:3000 out.png
 *   node screenshot.js http://localhost:3000 out.png "[data-page='story']"
 */

// @ts-nocheck
const { chromium } = require('playwright-core');
const path = require('path');

const url     = process.argv[2] || 'http://localhost:3000';
const outfile = process.argv[3] || path.join(__dirname, '../debug_screenshot.png');
const click   = process.argv[4] || null;   // optional CSS selector to click before screenshot
const delay   = parseInt(process.argv[5] || '1500');  // ms to wait after click

(async () => {
    const browser = await chromium.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });

    await page.goto(url, { waitUntil: 'networkidle' });

    if (click) {
        await page.click(click);
        await page.waitForTimeout(delay);
    }

    await page.screenshot({ path: outfile, fullPage: false });
    console.log('Screenshot saved:', outfile);
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
