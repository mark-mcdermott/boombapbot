import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const RULE = '='.repeat(64);

type Package = { name: string; version: string; private?: boolean };

/** The package a module belongs to: the nearest folder above it with a name and a version. */
function packageOf(moduleId: string): { root: string; manifest: Package } | null {
  let folder = dirname(moduleId.split('?')[0]!);
  while (folder !== dirname(folder)) {
    const manifestPath = join(folder, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<Package>;
      if (manifest.name && manifest.version) return { root: folder, manifest: manifest as Package };
    }
    folder = dirname(folder);
  }
  return null;
}

function licenceOf(root: string): string | null {
  const file = readdirSync(root).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
  return file ? readFileSync(join(root, file), 'utf8').trim() : null;
}

/**
 * Writes the licence of every package built into the page to
 * third-party-notices.txt, which the plugin's own notices take in. A package
 * with no licence text fails the build: its notice could not go with a copy.
 */
function thirdPartyNotices(): Plugin {
  return {
    name: 'boombapbot-third-party-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Map<string, string>();
      // A font a stylesheet names is no module of the page, only a file in it.
      const files = Object.values(bundle).flatMap((file) => (file.type === 'asset' ? file.originalFileNames : []));
      for (const id of [...this.getModuleIds(), ...files]) {
        if (!id.includes('/node_modules/')) continue;
        const found = packageOf(id);
        if (!found || found.manifest.private) continue;
        const title = `${found.manifest.name} ${found.manifest.version}`;
        if (packages.has(title)) continue;
        const licence = licenceOf(found.root);
        if (!licence) this.error(`${title} is built into the page and has no licence text in ${found.root}.`);
        packages.set(title, licence);
      }
      const notices = [...packages]
        .sort(([one], [other]) => one.localeCompare(other))
        .map(([title, licence]) => `\n${title}\n\n${licence}\n\n${RULE}\n`)
        .join('');
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: notices });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), thirdPartyNotices()],
  // The plugin serves the page from inside its bundle, at no address a file can name.
  base: './',
  build: { assetsInlineLimit: 0 },
});
