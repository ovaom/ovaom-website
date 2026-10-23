// Turn rendered Squarespace pages into a self-contained static site.
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RAW = process.argv[2];
const OUT = process.argv[3];
const SITE = 'https://www.ovaom.com';
const manifest = JSON.parse(fs.readFileSync(path.join(RAW, '_manifest.json'), 'utf8'));

const LOCAL_HOSTS = /(^|\.)(squarespace-cdn\.com|squarespace\.com|sqspcdn\.com)$/;
const DROP_PAGES = new Set(['/contactez-nous']);
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Map Squarespace paths to clean static paths
const routeOf = (p) => {
  const m = p.match(/^\/blog-ovaom\/category\/(.+)$/);
  if (m) return '/blog-ovaom/category/' + slugify(decodeURIComponent(m[1].replace(/\+/g, ' ')));
  return p;
};

// ---------- asset download ----------
const cache = new Map();
const extFromType = (t = '') => ({
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'text/css': '.css', 'font/woff2': '.woff2', 'font/woff': '.woff',
  'application/font-woff': '.woff', 'font/ttf': '.ttf', 'application/pdf': '.pdf',
}[t.split(';')[0].trim()] || '');

function absolutize(u, base) {
  u = u.trim().replace(/^['"]|['"]$/g, '');
  if (!u || u.startsWith('data:') || u.startsWith('#')) return null;
  if (u.startsWith('//')) u = 'https:' + u;
  try { return new URL(u, base).href; } catch { return null; }
}

async function localize(url, kind) {
  const abs = absolutize(url, SITE);
  if (!abs) return url;
  const host = new URL(abs).hostname;
  if (!LOCAL_HOSTS.test(host)) return url;
  let fetchUrl = abs;
  if (host === 'images.squarespace-cdn.com') {
    const base = abs.split('?')[0];
    fetchUrl = base + '?format=' + (kind === 'big' ? '2500w' : '1500w');
  } else {
    fetchUrl = abs.split('#')[0];
  }
  const key = fetchUrl.replace(/\?format=\d+w$/, '');
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    let res;
    for (let i = 0; i < 3; i++) {
      try { res = await fetch(fetchUrl); if (res.ok) break; } catch (e) { res = null; }
    }
    if (!res || !res.ok) { console.log('FAIL', res?.status, fetchUrl); return url; }
    const type = res.headers.get('content-type') || '';
    let ext = path.extname(new URL(fetchUrl).pathname).toLowerCase();
    if (!/^\.(jpe?g|png|gif|webp|svg|ico|css|woff2?|ttf|eot|otf|pdf|js)$/.test(ext)) ext = extFromType(type) || '.bin';
    const dir = /css/.test(ext) ? 'css' : /woff|ttf|eot|otf/.test(ext) ? 'fonts' : ext === '.pdf' ? 'files' : 'img';
    const name = crypto.createHash('sha1').update(key).digest('hex').slice(0, 14) + ext;
    const local = `/assets/${dir}/${name}`;
    let buf = Buffer.from(await res.arrayBuffer());
    if (ext === '.css') buf = Buffer.from(await rewriteCss(buf.toString('utf8'), fetchUrl));
    fs.mkdirSync(path.join(OUT, 'assets', dir), { recursive: true });
    fs.writeFileSync(path.join(OUT, local), buf);
    return local;
  })();
  cache.set(key, p);
  return p;
}

async function rewriteCss(css, base) {
  // drop squarespace UI icon fonts that need eot/svg variants we don't care about? keep all, they are small
  const urls = new Set();
  css.replace(/url\(\s*([^)]+?)\s*\)/g, (_, u) => { urls.add(u); return _; });
  css.replace(/@import\s+['"]([^'"]+)['"]/g, (_, u) => { urls.add(u); return _; });
  const map = {};
  await Promise.all([...urls].map(async (u) => {
    const abs = absolutize(u, base);
    if (!abs) return;
    const loc = await localize(abs, 'big');
    if (loc !== abs) map[u] = loc;
  }));
  return css
    .replace(/url\(\s*([^)]+?)\s*\)/g, (m, u) => (map[u] ? `url('${map[u]}')` : m))
    .replace(/@import\s+['"]([^'"]+)['"]/g, (m, u) => (map[u] ? `@import '${map[u]}'` : m));
}

// ---------- page transform ----------
const linkTarget = (href) => {
  if (!href) return href;
  let h = href.trim();
  const m = h.match(/^https?:\/\/(www\.)?ovaom\.com(\/.*)?$/i);
  if (m) h = m[2] || '/';
  if (!h.startsWith('/') || h.startsWith('//')) return href;
  const [p0, rest = ''] = h.split(/(?=[?#])/);
  let p = p0.replace(/\/$/, '') || '/';
  try { p = decodeURI(p); } catch {}
  return routeOf(p) + rest;
};

async function buildPage(srcPath, info) {
  const html = fs.readFileSync(path.join(RAW, info.file), 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });

  // Calendly booking widgets: drop the section they live in when it holds nothing else but a heading
  $('.sqs-block-code').filter((_, b) => /calendly/i.test($(b).html())).each((_, b) => {
    const section = $(b).closest('section');
    const others = section.find('.sqs-block').not(b).filter((_, o) => !$(o).is('.sqs-block-html') || $(o).text().trim().length > 120);
    if (section.length && !others.length) section.remove();
    else ($(b).closest('.fe-block').length ? $(b).closest('.fe-block') : $(b)).remove();
    console.log('  calendly widget removed from', srcPath);
  });

  // scripts, trackers, calendly, recaptcha
  $('script').not('.TextAttributes-props').remove(); // highlight configs are read further down
  $('noscript').remove();
  $('iframe[title="reCAPTCHA"], iframe[style*="display: none"]').remove();
  $('link[rel="preconnect"], link[rel="dns-prefetch"], link[rel="preload"], link[rel="modulepreload"], link[as="script"]').remove();
  $('*').contents().filter((_, n) => n.type === 'comment').remove();
  $('[class*="calendly"], [id*="calendly"]').remove();
  $('a[href*="calendly.com"]').closest('.sqs-block, .fe-block').remove();
  $('div[class*="grecaptcha"]').remove();

  // cookie banner
  $('.sqs-cookie-banner-v2, .sqs-cookie-banner, [class*="cookie-banner"]').remove();

  // forms & newsletter
  $('.form-block, .sqs-block-form, .newsletter-block, .sqs-block-newsletter').each((_, el) => {
    const fe = $(el).closest('.fe-block');
    (fe.length ? fe : $(el)).remove();
  });

  // cart + contact links
  $('.header-actions-action--cart, .cart-wrapper, [class*="cart-"] a[href="/cart"], a[href="/cart"]').remove();
  $('a[href="/contactez-nous"], a[href="https://www.ovaom.com/contactez-nous"]').each((_, a) => {
    const $a = $(a);
    const item = $a.closest('.header-nav-item, .header-menu-nav-item, .header-actions-action, .header-menu-cta, .sqs-block-button, .button-block');
    if (item.length) {
      const fe = item.closest('.fe-block');
      (item.is('.sqs-block-button, .button-block') && fe.length ? fe : item).remove();
    } else $a.replaceWith($a.html() || '');
  });

  // footer calls to action that only led to the newsletter / contact form
  $('.fe-block').each((_, el) => {
    const t = $(el).clone().find('style, script, template').remove().end().text().replace(/\s+/g, ' ').trim();
    if (t.length < 60 && /Ca m.{1,8}int.{1,8}resse|Une demande.{0,10}Contactez-nous|aimerais en apprendre plus sur le Sound Explorer/.test(t)) {
      const section = $(el).closest('section');
      $(el).remove();
      if (section.length && !section.find('.fe-block').length) section.remove();
    }
  });

  // videos: inline the iframe Squarespace injects with JS
  $('.sqs-video-wrapper[data-html]').each((_, el) => {
    const $el = $(el);
    const iframe = cheerio.load($el.attr('data-html'), null, false)('iframe');
    if (!iframe.length) return;
    iframe.removeAttr('width').removeAttr('height');
    iframe.attr('loading', 'lazy');
    iframe.attr('style', 'position:absolute;inset:0;width:100%;height:100%;border:0');
    $el.empty().append(`<div style="position:relative;width:100%;padding-bottom:56.25%">${$.html(iframe)}</div>`);
    $el.removeAttr('data-html').removeAttr('data-config-loading');
    $el.closest('.video-block, .sqs-block-video').find('.sqs-video-overlay, .video-player-overlay, .intrinsic-inner > .sqs-video-icon').remove();
  });

  // links
  $('a[href]').each((_, a) => { $(a).attr('href', linkTarget($(a).attr('href'))); });

  // Squarespace runtime metadata pointing at its CDNs
  $('picture source, meta[itemprop="thumbnailUrl"], link[rel="image_src"]').remove();
  $('*').each((_, el) => {
    for (const [k, v] of Object.entries(el.attribs || {})) {
      if (k.startsWith('data-') && /squarespace|sqspcdn/.test(v)) $(el).removeAttr(k);
    }
  });

  // image sizes Squarespace computed in JS for the capture viewport; let CSS size them instead
  $('.fe-block .fluid-image-component-root[style]').each((_, el) => {
    const s = $(el).attr('style').replace(/--image-component-container-(width|height):[^;]*;?/g, '');
    $(el).attr('style', s);
  });
  // circle-masked images and square images (app icons, game badges) must stay square at any width
  $('.fe-block .fluid-image-component-root').each((_, el) => {
    const block = $(el).closest('.sqs-block');
    const ratio = (block.find('style').text().match(/native-aspect-ratio: (\d+)\/(\d+)/) || []).slice(1).map(Number);
    const isSquare = ratio.length === 2 && Math.abs(ratio[0] / ratio[1] - 1) < 0.02;
    if ($(el).find('svg[data-image-mask-id]').length || isSquare) $(el).addClass('static-square');
  });

  // Squarespace draws text highlights as SVG overlays positioned in px for one viewport;
  // turn them into CSS on the highlighted span so they follow the text when it wraps
  $('.sqs-block-content').each((_, content) => {
    const shapes = {};
    $(content).find('.TextShape-node').each((_, n) => {
      const style = $(n).attr('style') || '';
      shapes[$(n).attr('data-text-attribute-id')] = {
        shape: $(n).attr('data-shape'),
        stroke: (style.match(/--stroke:\s*([^;]+)/) || [])[1],
        width: (style.match(/--stroke-width:\s*([^;]+)/) || [])[1],
      };
    }).remove();
    $(content).find('script.TextAttributes-props').each((_, s) => {
      let list = [];
      try { list = JSON.parse($(s).html()); } catch {}
      for (const a of list) {
        if (shapes[a.id]) continue;
        const h = a.color?.customColor?.hslaValue;
        shapes[a.id] = {
          shape: a.shape,
          stroke: h ? `hsla(${h.hue}, ${h.saturation * 100}%, ${h.lightness * 100}%, ${h.alpha})` : 'currentColor',
          width: a.thickness ? a.thickness.value + a.thickness.unit : undefined,
        };
      }
    });
    $(content).find('.sqsrte-text-highlight[data-text-attribute-id]').each((_, span) => {
      const sh = shapes[$(span).attr('data-text-attribute-id')];
      if (!sh) return;
      $(span).addClass(`static-hl static-hl--${sh.shape}`);
      $(span).attr('style', `--hl: ${sh.stroke};` + (sh.width ? ` --hl-w: ${sh.width};` : ''));
    });
  });
  $('script.TextAttributes-props').remove();

  // a highlight that starts mid-word ("t|ourner") takes in the start of that word
  const lastText = (n) => { for (let c = n; c; c = c.lastChild) if (c.type === 'text') return c; return null; };
  const firstText = (n) => { for (let c = n; c; c = c.firstChild) if (c.type === 'text') return c; return null; };
  $('.static-hl').each((_, span) => {
    const prev = lastText(span.prev);
    const first = firstText(span);
    const head = prev && first && /^\p{L}/u.test(first.data) && prev.data.match(/\p{L}+$/u);
    if (!head) return;
    prev.data = prev.data.slice(0, -head[0].length);
    first.data = head[0] + first.data;
  });

  // images
  const jobs = [];
  $('img').each((_, img) => {
    const $i = $(img);
    const src = $i.attr('data-src') || $i.attr('data-image') || $i.attr('src');
    if (!src) return;
    const big = $i.closest('.section-background, .banner-thumbnail-wrapper, .page-section').length && $i.closest('.section-background').length;
    jobs.push(localize(src, big ? 'big' : 'normal').then((loc) => {
      $i.attr('src', loc);
      ['srcset', 'sizes', 'data-src', 'data-image', 'data-srcset'].forEach((a) => $i.removeAttr(a));
    }));
  });
  $('[style*="url("]').each((_, el) => {
    const $e = $(el);
    jobs.push(rewriteCss($e.attr('style'), SITE).then((s) => $e.attr('style', s)));
  });
  $('style').each((_, el) => {
    const $e = $(el);
    jobs.push(rewriteCss($e.html(), SITE).then((s) => $e.html(s)));
  });
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const $e = $(el);
    jobs.push(localize($e.attr('href')).then((loc) => $e.attr('href', loc)));
  });
  $('link[rel*="icon"][href]').each((_, el) => {
    const $e = $(el);
    jobs.push(localize($e.attr('href')).then((loc) => $e.attr('href', loc)));
  });
  $('meta[property="og:image"], meta[itemprop="image"], meta[name="twitter:image"]').each((_, el) => {
    const $e = $(el);
    jobs.push(localize($e.attr('content')).then((loc) => $e.attr('content', loc.startsWith('/') ? SITE + loc : loc)));
  });
  $('a[href*="squarespace-cdn.com"]').each((_, el) => {
    const $e = $(el);
    jobs.push(localize($e.attr('href'), 'big').then((loc) => $e.attr('href', loc)));
  });
  await Promise.all(jobs);

  // canonical / og:url
  const route = routeOf(srcPath);
  $('link[rel="canonical"]').attr('href', SITE + route);
  $('meta[property="og:url"]').attr('content', SITE + route);

  // tiny replacement for Squarespace's header JS (mobile menu + folders)
  $('head').append('<link rel="stylesheet" href="/assets/site.css">');
  $('body').append('<script src="/assets/site.js" defer></script>');

  const outFile = route === '/' ? 'index.html' : route.replace(/^\//, '') + '/index.html';
  fs.mkdirSync(path.join(OUT, path.dirname(outFile)), { recursive: true });
  fs.writeFileSync(path.join(OUT, outFile), $.html());
  console.log('OK', route);
}

fs.mkdirSync(OUT, { recursive: true });
const pages = Object.entries(manifest).filter(([p, i]) => i.file && !DROP_PAGES.has(p));
for (let i = 0; i < pages.length; i += 4) {
  await Promise.all(pages.slice(i, i + 4).map(([p, info]) => buildPage(p, info)));
}
console.log('assets:', cache.size);
