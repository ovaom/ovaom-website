import * as cheerio from 'cheerio'; import fs from 'fs'; import path from 'path';
const root = process.argv[2];
const walk = d => fs.readdirSync(d, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(d,e.name)) : e.name.endsWith('.html') ? [path.join(d,e.name)] : []);
const bad = new Map();
const exists = (u) => { let p = decodeURIComponent(u.split(/[?#]/)[0]); const f = path.join(root, p); return fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f,'index.html'))); };
for (const f of walk(root)) { const $ = cheerio.load(fs.readFileSync(f,'utf8'));
  $('[href],[src]').each((_,e)=>{ for (const a of ['href','src']) { const u=$(e).attr(a); if (u && u.startsWith('/') && !u.startsWith('//') && !exists(u)) bad.set(u, path.relative(root,f)); } }); }
console.log([...bad].join('\n') || 'no broken internal links');
