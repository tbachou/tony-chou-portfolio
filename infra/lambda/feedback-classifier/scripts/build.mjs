// Packaging step 1 of 2 (see ../../README.md): bundles the TypeScript
// handler with esbuild, then zips the output to dist/lambda.zip. Step 2 is
// `terraform apply`, which reads that zip via filename + source_code_hash.
//
// Deliberately plain Node + esbuild + archiver — no local-exec/external
// Terraform data sources, so applies stay reproducible from a committed zip
// rather than a build that runs implicitly inside `terraform plan`.
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import archiver from 'archiver';
import { build } from 'esbuild';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const distDir = path.join(root, 'dist');
const bundlePath = path.join(distDir, 'index.js');
const zipPath = path.join(distDir, 'lambda.zip');

async function main() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: bundlePath,
    minify: true,
    sourcemap: false,
    // The AWS SDK v3 clients are provided by the Lambda Node 22 runtime
    // image; bundling them anyway is fine (they're small) but excluding
    // isn't necessary here since this is a from-scratch zip deployment,
    // not a layer. Keep them bundled for a self-contained artifact.
    logLevel: 'info',
  });

  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    // Lambda's `handler = "index.handler"` expects index.js at the zip root.
    archive.file(bundlePath, { name: 'index.js' });
    archive.finalize();
  });

  console.log(`built ${path.relative(root, zipPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
