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

for (const [page, why] of Object.entries(REQUIRED)) {
  if (!present.has(page)) {
    problems.push(`missing web/${page}, ${why}`);
  }
}

const pages = [...present].filter(name => name.endsWith('.html'));

for (const page of pages) {
  const body = readFileSync(join(WEB, page), 'utf8');

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

if (problems.length > 0) {
  console.error('web:check FAILED\n  ' + problems.join('\n  '));
  process.exit(1);
}

console.log(
  `web:check OK, ${pages.length} pages, links resolve, one contact address, all tokenised`,
);
