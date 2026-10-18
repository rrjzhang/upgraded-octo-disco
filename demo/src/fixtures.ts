/** Fixture content source, only imported (as a lazy chunk) when ?fixtures=1. */
import type { Source } from './content';
import { svgUrl } from './util';

const files = import.meta.glob('./__fixtures__/**/*', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export async function fixtureSource(): Promise<Source> {
  const svgs = new Map<string, string>();
  await Promise.all(
    Object.entries(files)
      .filter(([k]) => k.startsWith('./__fixtures__/assets/') && k.endsWith('.svg'))
      .map(async ([k, load]) => svgs.set(k.slice('./__fixtures__/assets/'.length), svgUrl(await load()))),
  );
  return {
    kind: 'fixtures',
    async text(path) {
      const load = files[`./__fixtures__/${path}`];
      return load ? await load() : null;
    },
    assetUrl(file) {
      if (file.startsWith('fx:')) return svgs.get(file.slice(3)) ?? '/__missing_fixture__/' + file.slice(3);
      return file;
    },
  };
}
