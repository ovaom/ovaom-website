// Render every page of ovaom.com in headless Chrome, crawl internal links, save final DOM.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2];
const seeds = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean);
const ORIGIN = 'https://www.ovaom.com';
const SKIP = /^\/(cart|checkout|account|commerce|api|s\/|config|search)/;

const norm = (u) => {
  try {
    const x = new URL(u, ORIGIN);
    if (x.hostname !== 'www.ovaom.com' && x.hostname !== 'ovaom.com') return null;
    let p = decodeURI(x.pathname).replace(/\/$/, '') || '/';
    if (SKIP.test(p)) return null;
    if (/\.(jpg|png|pdf|zip|mp3|mp4)$/i.test(p)) return null;
    // keep blog pagination/category/tag queries
    const q = x.searchParams.has('offset') ? '?offset=' + x.searchParams.get('offset') : '';
    return p + q;
  } catch { return null; }
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const queue = seeds.map(norm).filter(Boolean);
const seen = new Set(queue);
const manifest = {};

while (queue.length) {
  const p = queue.shift();
  try {
    const resp = await page.goto(ORIGIN + encodeURI(p.split('?')[0]) + (p.includes('?') ? '?' + p.split('?')[1] : ''), { waitUntil: 'networkidle2', timeout: 60000 });
    const status = resp?.status();
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 1500));
    const html = await page.evaluate(() => '<!DOCTYPE html>\n' + document.documentElement.outerHTML);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    const file = path.join(OUT, (p === '/' ? 'index' : p.replace(/^\//, '').replace('?offset=', '__offset_')) + '.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    manifest[p] = { status, file: path.relative(OUT, file), finalUrl: page.url() };
    console.log(status, p);
    for (const l of links) { const n = norm(l); if (n && !seen.has(n)) { seen.add(n); queue.push(n); } }
  } catch (e) { console.log('ERR', p, e.message); manifest[p] = { error: e.message }; }
}
fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
