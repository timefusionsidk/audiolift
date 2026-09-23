import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

export type Fmt = 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac';
export interface Opts { fmt: Fmt; br: number; ch: 0 | 1 | 2; sr: 0 | 44100 | 48000; vol: number; fi: number; fo: number }
export const FORMATS: Record<Fmt, { label: string; ext: string; mime: string; desc: string; codec: string[] }> = {
  mp3: { label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', desc: 'Best general compatibility and smaller files', codec: ['-c:a', 'libmp3lame'] },
  wav: { label: 'WAV', ext: 'wav', mime: 'audio/wav', desc: 'Uncompressed, highest compatibility for editing', codec: ['-c:a', 'pcm_s16le'] },
  m4a: { label: 'M4A / AAC', ext: 'm4a', mime: 'audio/mp4', desc: 'Efficient quality for phones and modern devices', codec: ['-c:a', 'aac'] },
  ogg: { label: 'OGG', ext: 'ogg', mime: 'audio/ogg', desc: 'Open format with efficient compression', codec: ['-c:a', 'libvorbis'] },
  flac: { label: 'FLAC', ext: 'flac', mime: 'audio/flac', desc: 'Lossless audio with a larger file size', codec: ['-c:a', 'flac', '-compression_level', '8'] },
};

let ff: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null; // single shared load: never two instances
let cancelled = false;
const log: string[] = [];

export function loadEngine(onStage?: (s: string) => void): Promise<FFmpeg> {
  if (ff?.loaded) return Promise.resolve(ff);
  if (!loading) {
    onStage?.('Downloading conversion engine');
    loading = (async () => {
      const f = new FFmpeg();
      f.on('log', ({ message }) => { log.push(message); if (log.length > 300) log.shift(); });
      try {
        await f.load({
          coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
          wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
        });
      } catch { f.terminate(); throw new Error('engine'); }
      ff = f;
      return f;
    })().finally(() => { loading = null; });
  }
  return loading;
}
export const warm = () => { loadEngine().catch(() => {}); };
export function cancelJob() { cancelled = true; ff?.terminate(); ff = null; }

export async function extract(
  file: File, o: Opts, start: number, dur: number,
  onStage: (s: string) => void, onPct: (p: number | null) => void,
): Promise<Blob> {
  cancelled = false;
  onStage('Preparing converter');
  const f = await loadEngine(onStage);
  if (cancelled) throw new Error('cancelled');
  log.length = 0;
  const F = FORMATS[o.fmt];
  const src = 'source.' + ((file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4');
  const out = 'audio.' + F.ext;
  const onProg = ({ time }: { progress: number; time: number }) => { if (dur > 0) onPct(Math.min(1, time / 1e6 / dur)); };
  f.on('progress', onProg);
  try {
    onStage('Reading video');
    await f.createDir('/in');
    // WORKERFS reads the File lazily: the video is never copied into memory
    await f.mount('WORKERFS' as never, { files: [new File([file], src)] } as never, '/in');
    onStage('Extracting audio');
    onPct(dur > 0 ? 0 : null);
    const a = ['-ss', String(start)];
    if (dur > 0) a.push('-t', String(dur));
    a.push('-i', '/in/' + src, '-vn', '-map', '0:a:0');
    const fl: string[] = [];
    if (o.vol !== 1) fl.push(`volume=${o.vol}`);
    if (o.fi) fl.push(`afade=t=in:st=0:d=${o.fi}`);
    if (o.fo && dur > o.fo) fl.push(`afade=t=out:st=${(dur - o.fo).toFixed(3)}:d=${o.fo}`);
    if (fl.length) a.push('-af', fl.join(','));
    if (o.ch) a.push('-ac', String(o.ch));
    if (o.sr) a.push('-ar', String(o.sr));
    a.push(...F.codec);
    if (o.fmt === 'mp3' || o.fmt === 'm4a' || o.fmt === 'ogg') a.push('-b:a', o.br + 'k');
    a.push(out);
    const code = await f.exec(a);
    if (cancelled) throw new Error('cancelled');
    if (code !== 0) throw new Error(log.some((l) => /matches no streams|does not contain any stream/.test(l)) ? 'noaudio' : 'fail');
    onStage('Finalising download');
    const d = await f.readFile(out);
    return new Blob([d as unknown as BlobPart], { type: F.mime });
  } catch (e) {
    if (cancelled) throw new Error('cancelled');
    const m = String((e as Error).message);
    throw new Error(m === 'noaudio' ? m : /memory|alloc|oom/i.test(m) ? 'oom' : 'fail');
  } finally {
    try {
      f.off('progress', onProg);
      await f.deleteFile(out).catch(() => {});
      await f.unmount('/in');
      await f.deleteDir('/in');
    } catch { /* instance terminated on cancel */ }
  }
}
