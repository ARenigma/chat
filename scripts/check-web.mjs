#!/usr/bin/env node
/**
 * Structural checks on the website.
 *
 * The site is five static files with no build step and no framework, which is
 * the right shape for three legal pages, but it also means nothing would notice
 * a broken link. Two of these pages are load-bearing outside the repo: Google
 * Play requires the privacy and data-deletion URLs to resolve, and Meta business
 * verification reads the site. A 404 on either is a rejection, not a cosmetic
 * bug, and it would be found by a reviewer rather than by us.
 *
 * So this asserts the things that are cheap to assert and expensive to get
 * wrong: the required pages exist, every internal link resolves, and every page
 * is wired to the generated token stylesheet so the site cannot drift away from
 * the app's palette one file at a time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'web');

/** Pages something outside this repo depends on. */
const REQUIRED = {
  'index.html': 'the landing page the APK link lives on',
  'privacy.html': 'Play requires this URL to resolve',
  'delete.html': 'Play requires a data-deletion URL',
  'terms.html': 'Play and Meta both look for terms',
  'about.html': 'Meta business verification reads the business details here',
};

const problems = [];
const present = new Set(readdirSync(WEB));
const DOWNLOAD_URL =
  'https://github.com/ARenigma/pappal-downloads/releases/latest/download/Pappal.apk';
const CONTACT_EMAIL = 'hello@pappal.live';
const CONTACT_PHONE = 'tel:+917057887915';
const BUSINESS_ADDRESS =
  'Building 145, Sector 44 Road, Gurugram, Haryana 122003, India';

for (const [page, why] of Object.entries(REQUIRED)) {
  if (!present.has(page)) {
    problems.push(`missing web/${page}, ${why}`);
  }
}

const pages = [...present].filter(name => name.endsWith('.html'));

for (const page of pages) {
  const body = readFileSync(join(WEB, page), 'utf8');
  const plainText = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  // Internal links only: an external 404 is not ours to police, and checking
  // them would make this gate depend on the network.
  for (const [, href] of body.matchAll(/href="\/([^"#]*)"/g)) {
    const target = href === '' ? 'index.html' : href;
    if (!present.has(target)) {
      problems.push(`web/${page} links to /${href}, which does not exist`);
    }
  }

  // The generated stylesheet is what keeps the site and the app the same
  // product. A page that forgets it still renders, just wrong, and only on
  // that one page, which is the kind of thing nobody spots.
  if (!body.includes('/tokens.css')) {
    problems.push(`web/${page} does not link tokens.css`);
  }

  // Release assets inherit repository visibility. The app source repositories
  // are private, so every CTA must use the downloads-only public repository.
  if (!body.includes(DOWNLOAD_URL)) {
    problems.push(`web/${page} does not link the public latest APK`);
  }
  if (body.includes('gitlab.com/ARenigma/chat/-/releases')) {
    problems.push(`web/${page} still links the private source repository`);
  }

  // Cashfree compares these public details with the merchant's KYC record.
  // Require the canonical values on every page because every legal page can be
  // reviewed as an independent entry URL.
  if (!body.includes(`mailto:${CONTACT_EMAIL}`)) {
    problems.push(`web/${page} does not publish ${CONTACT_EMAIL}`);
  }
  if (!body.includes(CONTACT_PHONE)) {
    problems.push(`web/${page} does not publish the support phone`);
  }
  if (!plainText.includes(BUSINESS_ADDRESS)) {
    problems.push(`web/${page} does not publish the verified business address`);
  }
  if (
    body.includes('hello@axionix.tech') ||
    plainText.includes('Noida, Uttar Pradesh')
  ) {
    problems.push(`web/${page} still publishes stale business contact details`);
  }

  // The site and the app are one product. Geist + Titan One are the shipped
  // faces; Nunito was the previous web-only stand-in and must not return.
  if (!body.includes('family=Geist') || !body.includes('family=Titan+One')) {
    problems.push(`web/${page} does not load Geist and Titan One`);
  }
  if (body.includes('family=Nunito')) {
    problems.push(`web/${page} still loads Nunito`);
  }

  // A page with no way back is a dead end on a phone.
  if (page !== 'index.html' && !/href="\/"|href="\/index\.html"/.test(body)) {
    problems.push(`web/${page} has no link home`);
  }
}

// The contact address appears on several pages and in the Play listing. One
// stale copy is how a support email stops working.
const addresses = new Set();
for (const page of pages) {
  for (const [, address] of readFileSync(join(WEB, page), 'utf8').matchAll(
    /mailto:([^"]+)"/g,
  )) {
    addresses.add(address);
  }
}
if (addresses.size > 1) {
  problems.push(
    `the site advertises ${addresses.size} contact addresses: ${[
      ...addresses,
    ].join(', ')}`,
  );
}
if (
  [...addresses].some(address => /example\.(com|invalid|org)/.test(address))
) {
  problems.push('a placeholder contact address is still published');
}
if (addresses.size !== 1 || !addresses.has(CONTACT_EMAIL)) {
  problems.push(`the canonical contact address must be ${CONTACT_EMAIL}`);
}

// Cashfree website whitelisting requires services and prices in INR. Keep the
// public rate card aligned with the application's fallback economics.
const pricing = readFileSync(join(WEB, 'pricing.html'), 'utf8');
for (const required of [
  '₹22 per minute for text chat',
  '₹22 per minute for voice',
  '₹35 per minute for video',
  '₹100, ₹300, ₹500, ₹1,000, ₹2,500',
]) {
  if (!pricing.includes(required)) {
    problems.push(
      `web/pricing.html is missing canonical INR pricing: ${required}`,
    );
  }
}

/**
 * The public position is a neutral, safety-first social conversation platform.
 * These phrases previously marketed paid companionship, loneliness, or adult
 * subject matter. A Play metadata upload can overwrite the website wording, so
 * scan every publishable copy source rather than only web/index.html.
 */
const publicCopyRoots = [
  WEB,
  join(ROOT, 'play-upload', '04-listing-copy'),
  join(ROOT, 'fastlane', 'metadata', 'android'),
];
const forbiddenPositioning = [
  /someone to talk to/i,
  /not therapy,\s*just company/i,
  /pay(?:ing)? per minute/i,
  /pay only for the time/i,
  /recharge your balance to talk/i,
  /free tokens/i,
  /adults only/i,
  /adult loneliness/i,
  /earn per minute/i,
];

function copyFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return copyFiles(path);
    return /\.(html|txt)$/.test(entry.name) ? [path] : [];
  });
}

for (const root of publicCopyRoots) {
  for (const file of copyFiles(root)) {
    const body = readFileSync(file, 'utf8');
    for (const phrase of forbiddenPositioning) {
      if (phrase.test(body)) {
        problems.push(
          `${file.slice(
            ROOT.length + 1,
          )} contains retired positioning ${phrase}`,
        );
      }
    }
  }
}

const canonicalUrlFiles = [
  join(ROOT, '.gitlab-ci.yml'),
  join(ROOT, 'docs', 'play', 'listing.md'),
  join(ROOT, 'play-upload', 'README.md'),
  join(ROOT, 'src', 'lib', 'legal.ts'),
];
for (const file of canonicalUrlFiles) {
  if (readFileSync(file, 'utf8').includes('bond-app.vercel.app')) {
    problems.push(
      `${file.slice(ROOT.length + 1)} points at the unrelated bond-app site`,
    );
  }
}

if (problems.length > 0) {
  console.error('web:check FAILED\n  ' + problems.join('\n  '));
  process.exit(1);
}

console.log(
  `web:check OK, ${pages.length} pages, links resolve, one contact address, all tokenised`,
);
