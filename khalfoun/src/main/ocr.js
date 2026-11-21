// Reading text from a screenshot with Windows' own OCR engine
// (Windows.Media.Ocr, built into Windows 10 and 11, works offline). Arabic is
// used when the Arabic language is installed in Windows; otherwise the
// languages of the user's profile (usually English).

import { execFile } from 'node:child_process';

/** PowerShell (Windows PowerShell 5.1, which can reach WinRT) that prints one line of text per OCR line. */
export function ocrScript(imagePath, { words = false } = {}) {
  const path = String(imagePath).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${path}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = $null
if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported([Windows.Globalization.Language]::new('ar'))) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ar')) }
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { Write-Output '#NOENGINE'; exit 0 }
Write-Output ('#LANG ' + $engine.RecognizerLanguage.LanguageTag)
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) { Write-Output $line.Text }
${words ? `$n = 0
foreach ($line in $result.Lines) {
  foreach ($w in $line.Words) { $r = $w.BoundingRect; Write-Output ('#W ' + $n + ' ' + [int]$r.X + ' ' + [int]$r.Y + ' ' + [int]$r.Width + ' ' + [int]$r.Height + ' ' + $w.Text) }
  $n++
}` : ''}
`;
}

/** Splits the script's output into {language, text} or an error. */
export function parseOcrOutput(stdout) {
  const lines = String(stdout || '').replace(/\r/g, '').split('\n');
  if (lines.some((l) => l.trim() === '#NOENGINE')) return { ok: false, error: 'no_ocr_language' };
  const lang = (lines.find((l) => l.startsWith('#LANG ')) || '').slice(6).trim() || null;
  const text = lines.filter((l) => !l.startsWith('#')).map((l) => l.trim()).filter(Boolean).join('\n');
  // «#W line x y w h word»: where each word is, in the picture's pixels.
  const words = [];
  for (const l of lines) {
    const m = /^#W (\d+) (-?\d+) (-?\d+) (\d+) (\d+) (.+)$/.exec(l.trim());
    if (m) words.push({ line: Number(m[1]), x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]), text: m[6] });
  }
  return { ok: true, data: { text: text.slice(0, 6000), language: lang, ...(words.length ? { words: words.slice(0, 4000) } : {}) } };
}

/**
 * @param {string} imagePath PNG on disk
 * @param {{run?: typeof execFile, platform?: string}} [opts]
 */
export function ocrImage(imagePath, opts = {}) {
  if ((opts.platform || process.platform) !== 'win32') return Promise.resolve({ ok: false, error: 'unsupported' });
  const run = opts.run || execFile;
  const encoded = Buffer.from(ocrScript(imagePath, { words: Boolean(opts.words) }), 'utf16le').toString('base64');
  return new Promise((resolve) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
        if (err && !stdout) { resolve({ ok: false, error: `ocr_failed: ${err.message}` }); return; }
        resolve(parseOcrOutput(stdout));
      });
  });
}
