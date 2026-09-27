import { readFileSync, writeFileSync } from 'node:fs';

const raw = process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://audiolift.timefusionsidk.com';
const origin = raw.replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/i.test(origin)) throw new Error('SITE_URL must be a full HTTPS origin without a path.');

const paths = ['', '/privacy', '/terms', '/contact'];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>\n`;
writeFileSync('public/sitemap.xml', sitemap);
writeFileSync('public/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);

const index = readFileSync('index.html', 'utf8')
  .replaceAll('https://audiolift.timefusionsidk.com/', `${origin}/`);
writeFileSync('index.html', index);
