const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectPath = path.join(__dirname, '..');
const converterPath = path.join(projectPath, 'tools', 'convert-posf.ps1');

test('converter rejects an unknown explicit endpoint ID before exact-count validation', () => {
  const temporaryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-posf-'));
  const fixturePath = path.join(temporaryPath, 'fixture');
  const sourcePath = path.join(temporaryPath, 'unknown-endpoint.posf');
  const outputPath = path.join(temporaryPath, 'data.js');
  fs.mkdirSync(fixturePath);

  try {
    fs.writeFileSync(path.join(fixturePath, 'meta.json'), JSON.stringify({ mainCanvasId: 'canvas' }));
    fs.writeFileSync(path.join(fixturePath, 'canvas.pos'), JSON.stringify({
      diagram: {
        elements: {
          elements: {
            knownA: {
              id: 'known-a',
              props: { x: 0, y: 0, w: 100, h: 50 },
              textBlock: [{ text: 'Known A' }]
            },
            knownB: {
              id: 'known-b',
              props: { x: 200, y: 0, w: 100, h: 50 },
              textBlock: [{ text: 'Known B' }]
            },
            edge: {
              id: 'edge-1',
              name: 'linker',
              from: { id: 'missing-explicit', x: 50, y: 25 },
              to: { id: 'known-b', x: 250, y: 25 }
            }
          }
        }
      }
    }));

    const archive = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:WT_FIXTURE_PATH, $env:WT_SOURCE_PATH)'
    ], {
      encoding: 'utf8',
      env: { ...process.env, WT_FIXTURE_PATH: fixturePath, WT_SOURCE_PATH: sourcePath }
    });
    assert.equal(archive.status, 0, archive.stderr || archive.stdout);

    const conversion = spawnSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', converterPath,
      '-Source', sourcePath,
      '-Output', outputPath
    ], { encoding: 'utf8' });
    const diagnostics = `${conversion.stdout || ''}\n${conversion.stderr || ''}`;

    assert.notEqual(conversion.status, 0, 'conversion fails for an unknown explicit endpoint ID');
    assert.match(diagnostics, /Unknown linker endpoint ID: missing-explicit/);
    assert.doesNotMatch(diagnostics, /Unexpected counts/, 'endpoint validation runs before exact-count validation');
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
  }
});
