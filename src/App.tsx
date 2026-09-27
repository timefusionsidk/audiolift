import { useEffect, useRef, useState } from 'react';
import { AudioWaveform, Download, Layers, Loader2, MonitorSmartphone, RotateCcw, Scissors, ShieldCheck, Stamp, Trash2, Upload, UserX, X } from 'lucide-react';
import { FORMATS, Fmt, Opts, cancelJob, extract, warm } from './engine';

const EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpeg', 'mpg'];
const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? '';
const T = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const B = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const MSG: Record<string, string> = {
  noaudio: 'This file does not appear to contain an audio track.',
  oom: 'Your browser ran out of memory while processing this file. Try closing other tabs, using a computer, or selecting a smaller video.',
  engine: 'The converter could not be loaded. Check your connection and retry.',
  fail: 'Audio extraction failed. Try a smaller file or a different output format.',
};
const supported = typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined';

/* ---------- Ads: script loads only when fully configured ---------- */
type AdW = Window & { adsbygoogle?: unknown[] };
function AdSlot({ slot, label = 'Advertisement' }: { slot?: string; label?: string }) {
  const pub = import.meta.env.VITE_AD_PUBLISHER_ID as string | undefined;
  const on = import.meta.env.VITE_AD_PROVIDER === 'adsense' && !!pub && !!slot;
  useEffect(() => {
    if (!on) return;
    if (!document.querySelector('script[data-ads]')) {
      const s = document.createElement('script');
      s.async = true; s.crossOrigin = 'anonymous'; s.dataset.ads = '1';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${pub}`;
      document.head.appendChild(s);
    }
    try { const w = window as AdW; (w.adsbygoogle = w.adsbygoogle || []).push({}); } catch { /* ad blocked */ }
  }, [on, pub, slot]);
  if (!on) return import.meta.env.DEV ? <div className="my-8 rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-stone-500">Ad placeholder (dev only) – ads not configured</div> : null;
  return (
    <aside className="my-10 text-center" aria-label={label}>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
      <ins className="adsbygoogle block" style={{ display: 'block' }} data-ad-client={pub} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}

/* ---------- Converter ---------- */
type Res = { url: string; size: number; name: string; dur: number };
function Converter() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [meta, setMeta] = useState<{ dur: number; w: number; h: number } | null>(null);
  const [noPrev, setNoPrev] = useState(false);
  const [o, setO] = useState<Opts>({ fmt: 'mp3', br: 192, ch: 0, sr: 0, vol: 1, fi: 0, fo: 0 });
  const [rg, setRg] = useState<[number, number]>([0, 0]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [el, setEl] = useState(0);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (res) URL.revokeObjectURL(res.url); }, [res]);
  useEffect(() => () => cancelJob(), []);
  useEffect(() => {
    const openPicker = () => fileInput.current?.click();
    window.addEventListener('audiolift-open-picker', openPicker);
    return () => window.removeEventListener('audiolift-open-picker', openPicker);
  }, []);

  const reset = () => {
    if (busy) cancelJob();
    if (url) URL.revokeObjectURL(url);
    if (res) URL.revokeObjectURL(res.url);
    if (fileInput.current) fileInput.current.value = '';
    setFile(null); setUrl(''); setMeta(null); setNoPrev(false); setRes(null); setErr(''); setBusy(false); setPct(null);
  };
  const pick = (f?: File) => {
    if (!f) return;
    reset();
    if (!(EXTS.includes(ext(f.name)) || f.type.startsWith('video/'))) return setErr('Please select a supported video file.');
    if (!f.size) return setErr('This file is empty. Please choose another video.');
    if (f.size > 2_000_000_000) return setErr('This video is over 2 GB and is unlikely to work reliably in a browser. Please choose a smaller file.');
    setFile(f); setUrl(URL.createObjectURL(f)); warm();
  };

  const dur = meta ? rg[1] - rg[0] : 0;
  const rangeErr = !meta ? '' : rg[0] < 0 ? 'Start time cannot be negative.' : rg[1] > meta.dur + 0.01 ? 'End time exceeds the video length.' : rg[1] <= rg[0] ? 'End time must be after the start time.' : '';
  const lossy = o.fmt === 'mp3' || o.fmt === 'm4a' || o.fmt === 'ogg';
  const est = dur <= 0 ? 0 : lossy ? (o.br * 1000 / 8) * dur : (((o.sr || 44100) * 2 * (o.ch || 2)) / (o.fmt === 'flac' ? 1.7 : 1)) * dur;
  const set = (p: Partial<Opts>) => setO((x) => ({ ...x, ...p }));

  async function go() {
    if (busy || !file || rangeErr) return;
    setErr(''); setRes(null); setBusy(true); setPct(null); setEl(0);
    const t0 = Date.now(); const iv = setInterval(() => setEl((Date.now() - t0) / 1000), 500);
    try {
      const blob = await extract(file, o, meta ? rg[0] : 0, dur, setStage, setPct);
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'audio';
      setRes({ url: URL.createObjectURL(blob), size: blob.size, name: `${base}-audio.${FORMATS[o.fmt].ext}`, dur });
    } catch (e) { const c = (e as Error).message; setErr(c === 'cancelled' ? 'Conversion cancelled. Your video is still loaded.' : MSG[c] ?? MSG.fail); }
    finally { clearInterval(iv); setBusy(false); }
  }

  if (!supported) return <div role="alert" className="card p-6">Your browser does not support WebAssembly and Web Workers, which AudioLift needs. Please use a recent Chrome, Edge, Firefox or Safari.</div>;

  const Err = err && (
    <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{err}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {file && !busy && <button className="btn-s !min-h-11 text-sm" onClick={go}><RotateCcw size={16} />Retry</button>}
        <label className="btn-s cursor-pointer text-sm">Choose another file<input type="file" hidden accept="video/*,.mkv,.avi,.mpeg,.mpg,.m4v" onChange={(e) => pick(e.target.files?.[0])} /></label>
      </div>
    </div>
  );

  if (!file) return (
    <div>
      {Err}
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition focus-within:outline focus-within:outline-3 focus-within:outline-indigo-500 sm:p-12 ${drag ? 'border-indigo-500 bg-indigo-50' : 'border-stone-300 bg-white hover:border-indigo-400'}`}>
        <Upload className="text-indigo-600" size={32} aria-hidden />
        <span className="text-xl font-semibold">Upload a video</span>
        <span className="text-stone-600">Drop your video here or choose a file from your device.</span>
        <span className="btn-p">Choose Video</span>
        <span className="text-sm text-stone-500">MP4, MOV, WEBM, MKV, AVI and more. Under 500 MB recommended; larger files may fail on phones.</span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-indigo-700"><ShieldCheck size={16} aria-hidden />Your files never leave your device. All processing happens privately in your browser.</span>
        <input ref={fileInput} type="file" className="sr-only" accept="video/*,.mkv,.avi,.mpeg,.mpg,.m4v" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
    </div>
  );

  if (res) return (
    <div className="card p-5 sm:p-8" aria-live="polite">
      <h3 className="text-2xl font-bold">Your audio is ready</h3>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[['File', res.name], ['Format', FORMATS[o.fmt].label], ['Size', B(res.size)], ['Duration', res.dur ? T(res.dur) : '—']].map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-stone-500">{k}</dt><dd className="truncate font-medium" title={v}>{v}</dd></div>)}
      </dl>
      <audio className="mt-5 w-full" controls src={res.url} />
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <a className="btn-p" href={res.url} download={res.name}><Download size={18} />Download</a>
        <button className="btn-s" onClick={() => setRes(null)}>Change Settings</button>
        <button className="btn-s" onClick={reset}>Convert Another Video</button>
      </div>
      <AdSlot slot={import.meta.env.VITE_AD_SLOT_RESULT} />
    </div>
  );

  const eta = pct && pct > 0.1 ? Math.round((el / pct) * (1 - pct)) : null;
  return (
    <div className="card p-4 sm:p-6">
      {Err}
      {file.size > 5e8 && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This file may be too large for your device to process in a browser. Try closing other tabs, using a computer, or selecting a smaller video.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          {noPrev ? <p className="rounded-xl bg-stone-100 p-4 text-sm">This format cannot be previewed in your browser, but AudioLift can still attempt to extract its audio.</p>
            : <video src={url} controls playsInline className="max-h-80 w-full rounded-xl bg-black" onLoadedMetadata={(e) => { const v = e.currentTarget; if (isFinite(v.duration)) { setMeta({ dur: v.duration, w: v.videoWidth, h: v.videoHeight }); setRg([0, v.duration]); } }} onError={() => setNoPrev(true)} />}
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {[['Name', file.name], ['Type', file.type || ext(file.name).toUpperCase()], ['Size', B(file.size)], ['Duration', meta ? T(meta.dur) : 'Unknown'], ['Resolution', meta?.w ? `${meta.w}×${meta.h}` : 'Unknown'], ['Audio track', 'Checked during extraction'], ['Est. output', est ? '≈ ' + B(est) : '—']].map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-stone-500">{k}</dt><dd className="truncate font-medium" title={v}>{v}</dd></div>)}
          </dl>
          <button className="btn-s mt-3 text-sm" onClick={reset} disabled={busy}><X size={16} />Remove file</button>{' '}
          <label className="btn-s mt-3 cursor-pointer text-sm">Replace file<input type="file" hidden accept="video/*,.mkv,.avi,.mpeg,.mpg,.m4v" onChange={(e) => pick(e.target.files?.[0])} /></label>
        </div>
        <div className="min-w-0 space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <div><label htmlFor="fmt" className="mb-1 block text-sm font-semibold">Output format</label>
              <select id="fmt" className="inp" value={o.fmt} onChange={(e) => set({ fmt: e.target.value as Fmt })}>{(Object.keys(FORMATS) as Fmt[]).map((k) => <option key={k} value={k}>{FORMATS[k].label}</option>)}</select>
              <p className="mt-1 text-sm text-stone-600">{FORMATS[o.fmt].label} — {FORMATS[o.fmt].desc}</p></div>
            {lossy && <div><label htmlFor="q" className="mb-1 block text-sm font-semibold">Quality</label>
              <select id="q" className="inp" value={o.br} onChange={(e) => set({ br: +e.target.value })}>{[[96, 'Low'], [128, 'Standard'], [192, 'High'], [256, 'Very High'], [320, 'Maximum']].map(([b, n]) => <option key={b} value={b}>{n}: {b} kbps</option>)}</select></div>}
            {o.fmt === 'wav' && <div><label htmlFor="q" className="mb-1 block text-sm font-semibold">Quality</label>
              <select id="q" className="inp" value={o.sr || 44100} onChange={(e) => set({ sr: +e.target.value as 44100 | 48000 })}><option value={44100}>44.1 kHz, 16-bit</option><option value={48000}>48 kHz, 16-bit</option></select></div>}
            {o.fmt === 'flac' && <p className="text-sm text-stone-600">Lossless, 16-bit-compatible compression (level 8). No bitrate needed.</p>}
            {meta && <div className="space-y-2"><p className="text-sm font-semibold">Trim ({T(Math.max(0, dur))} selected)</p>
              {([0, 1] as const).map((i) => <div key={i} className="grid grid-cols-[4rem_1fr_5.5rem] items-center gap-2">
                <label htmlFor={`t${i}`} className="text-sm">{i ? 'End' : 'Start'} (s)</label>
                <input aria-label={i ? 'End slider' : 'Start slider'} type="range" min={0} max={meta.dur} step={0.1} value={rg[i]} onChange={(e) => setRg((r) => (i ? [r[0], +e.target.value] : [+e.target.value, r[1]]))} className="h-11 w-full" />
                <input id={`t${i}`} type="number" step={0.1} min={0} className="inp" value={Number(rg[i].toFixed(2))} onChange={(e) => setRg((r) => (i ? [r[0], +e.target.value] : [+e.target.value, r[1]]))} /></div>)}
              {rangeErr && <p role="alert" className="text-sm text-red-700">{rangeErr}</p>}
              <button type="button" className="btn-s text-sm" onClick={() => setRg([0, meta.dur])}>Reset to full length</button></div>}
            <details className="rounded-xl border border-stone-200 p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Advanced settings</summary>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                {([['Channels', 'ch', [[0, 'Original'], [1, 'Mono'], [2, 'Stereo']]], ['Sample rate', 'sr', [[0, 'Original'], [44100, '44.1 kHz'], [48000, '48 kHz']]], ['Volume', 'vol', [[0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']]], ['Fade in', 'fi', [[0, 'Off'], [1, '1 s'], [2, '2 s'], [3, '3 s']]], ['Fade out', 'fo', [[0, 'Off'], [1, '1 s'], [2, '2 s'], [3, '3 s']]]] as [string, keyof Opts, [number, string][]][]).map(([l, k, opts]) =>
                  <div key={k}><label htmlFor={k} className="mb-1 block font-medium">{l}</label><select id={k} className="inp" value={o[k] as number} onChange={(e) => set({ [k]: +e.target.value } as Partial<Opts>)}>{opts.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>)}
              </div></details>
          </fieldset>
          {busy ? (
            <div role="status" aria-live="polite" className="rounded-xl bg-indigo-50 p-4">
              <p className="flex items-center gap-2 font-semibold"><Loader2 className="animate-spin motion-reduce:animate-none" size={18} />{stage}{stage === 'Extracting audio' && pct !== null ? ` — ${Math.round(pct * 100)}%` : ''}</p>
              <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-indigo-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct !== null ? Math.round(pct * 100) : undefined}>
                {pct !== null ? <div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct * 100}%` }} /> : <div className="slide absolute h-full w-1/3 bg-indigo-600" />}</div>
              <p className="mt-2 text-sm text-stone-600">Elapsed {T(el)}{eta !== null && ` · about ${T(eta)} left`}. The first conversion may take longer because the engine must be downloaded. Everything stays on your device.</p>
              <button className="btn-s mt-3" onClick={() => cancelJob()}>Cancel</button>
            </div>
          ) : <button className="btn-p w-full !min-h-12 text-lg" onClick={go} disabled={!!rangeErr}>Extract Audio</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Page content ---------- */
const FEATURES: [typeof ShieldCheck, string, string][] = [
  [ShieldCheck, 'Private local processing', 'Conversion runs on your own device.'], [Layers, 'Multiple audio formats', 'MP3, WAV, M4A, OGG and FLAC.'],
  [Scissors, 'Video trimming', 'Extract just the section you need.'], [AudioWaveform, 'High-quality audio', 'Up to 320 kbps or lossless.'],
  [UserX, 'Works without an account', 'No sign-up, no login.'], [MonitorSmartphone, 'Mobile and desktop', 'Responsive from 320px upward.'],
  [Stamp, 'No watermarks', 'Clean files, nothing added.'], [Trash2, 'No permanent storage', 'Closing the page clears everything.'],
];
const FAQ: [string, string][] = [
  ['Is my video uploaded anywhere?', 'No. The video is read and converted by FFmpeg WebAssembly inside your browser. Nothing is sent to AudioLift servers.'],
  ['How do I convert MP4 or MOV to MP3?', 'Choose your video, keep MP3 selected, and click Extract Audio. The same steps work for extracting audio from MP4, MOV, WEBM and MKV, or for a video to WAV converter workflow.'],
  ['Why is the first conversion slower?', 'The processing engine (about 30 MB) is downloaded once, then cached by your browser.'],
  ['Why did a large file fail?', 'Browsers limit memory, especially on phones. Close other tabs, use a computer, or trim to a smaller video.'],
  ['Can I download from YouTube or TikTok?', 'No. AudioLift only processes files from your device. Only use videos you own or have permission to use.'],
];
const Wave = () => <div className="flex h-24 items-center justify-center gap-1" aria-hidden>{Array.from({ length: 32 }, (_, i) => <span key={i} className="bar w-1.5 rounded-full bg-gradient-to-t from-indigo-600 to-violet-400" style={{ height: `${20 + Math.abs(Math.sin(i * 0.8)) * 70}%`, animationDelay: `${i * 60}ms` }} />)}</div>;

function Home() {
  return (<>
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#fbfaf8]/95 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <a href="/" className="flex min-h-11 items-center gap-2 text-lg font-extrabold"><AudioWaveform className="text-indigo-600" />AudioLift</a>
        <div className="hidden items-center gap-5 text-sm font-medium md:flex">{[['Extract Audio', '#extract'], ['How It Works', '#how'], ['Formats', '#formats'], ['FAQ', '#faq'], ['Privacy', '/privacy'], ['Contact', '/contact']].map(([l, h]) => <a key={l} href={h} className="hover:text-indigo-600">{l}</a>)}</div>
        <button type="button" className="btn-p !min-h-11 text-sm" onClick={() => { document.getElementById('extract')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.setTimeout(() => window.dispatchEvent(new Event('audiolift-open-picker')), 250); }}>Choose Video</button>
      </nav>
    </header>
    <main>
      <section id="extract" className="mx-auto max-w-6xl px-4 pb-8 pt-12 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">Extract audio from any video</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-stone-600">Convert videos to MP3, WAV, M4A and more—free, fast, and completely private.</p>
        <ul className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm font-medium text-stone-700">{['No uploads', 'No account', 'No file storage', 'Free browser-based conversion'].map((t) => <li key={t}>✓ {t}</li>)}</ul>
        <Wave />
        <div className="mx-auto mt-2 max-w-6xl text-left"><Converter /></div>
        <p className="mt-3 text-xs text-stone-500">Only process videos that you own or have permission to use. AudioLift does not download videos from third-party platforms.</p>
        <AdSlot slot={import.meta.env.VITE_AD_SLOT_UPLOAD} />
      </section>
      <section className="mx-auto max-w-4xl px-4 py-12" id="privacy"><h2 className="text-3xl font-bold">Private by design</h2>
        <p className="mt-3 text-stone-700">AudioLift loads a conversion engine into your browser and reads your video from disk on your device. The extracted audio is held in browser memory until you download it. Refreshing or closing the page clears the project. There is no upload step, no database and no account.</p></section>
      <section id="how" className="mx-auto max-w-6xl px-4 py-12"><h2 className="text-3xl font-bold">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">{[['Choose a video', 'Select a video directly from your device.'], ['Customise the audio', 'Choose the format, quality, and section you want.'], ['Extract and download', 'Audio is processed privately in your browser and downloaded to your device.']].map(([t, d], i) => <li key={t} className="card p-5"><span className="text-sm font-bold text-indigo-600">Step {i + 1}</span><h3 className="text-lg font-semibold">{t}</h3><p className="text-stone-600">{d}</p></li>)}</ol></section>
      <AdSlot slot={import.meta.env.VITE_AD_SLOT_CONTENT} />
      <section id="formats" className="mx-auto max-w-6xl px-4 py-12"><h2 className="text-3xl font-bold">Supported formats</h2>
        <p className="mt-3 text-stone-700"><b>Input:</b> MP4, MOV, WEBM, MKV, AVI, M4V, MPEG, MPG. Some formats (such as MKV or AVI) may not preview in your browser but can usually still be converted.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{(Object.keys(FORMATS) as Fmt[]).map((k) => <li key={k} className="card p-4"><b>{FORMATS[k].label}</b><p className="text-sm text-stone-600">{FORMATS[k].desc}</p></li>)}</ul></section>
      <section className="mx-auto max-w-6xl px-4 py-12"><h2 className="text-3xl font-bold">Why AudioLift</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{FEATURES.map(([I, t, d]) => <li key={t} className="card p-5"><I className="text-indigo-600" aria-hidden /><h3 className="mt-2 font-semibold">{t}</h3><p className="text-sm text-stone-600">{d}</p></li>)}</ul></section>
      <section id="faq" className="mx-auto max-w-3xl px-4 py-12"><h2 className="text-3xl font-bold">Frequently asked questions</h2>
        <div className="mt-6 space-y-3">{FAQ.map(([q, a]) => <details key={q} className="card px-4"><summary className="min-h-11 cursor-pointer py-3 font-semibold">{q}</summary><p className="pb-4 text-stone-700">{a}</p></details>)}</div></section>
    </main>
    <Footer />
  </>);
}

const Footer = () => <footer className="border-t border-stone-200 py-8 text-center text-sm text-stone-600">
  <p>© {new Date().getFullYear()} AudioLift · <a className="underline" href="/privacy">Privacy Policy</a> · <a className="underline" href="/terms">Terms of Use</a> · <a className="underline" href="/contact">Contact</a></p>
  <p className="mx-auto mt-2 max-w-xl px-4">Copyright: only process media you own or have permission to use. AudioLift does not download videos from third-party platforms.</p></footer>;

function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const priv = kind === 'privacy';
  const items = priv
    ? ['Video and audio files are processed locally in your browser.', 'Files are not intentionally uploaded to AudioLift servers and are not stored in any database.', 'Refreshing or closing the page clears the active project.', 'When advertising is enabled, advertising providers such as Google may use cookies, device identifiers, and similar technologies to show and measure ads. Their use of data is governed by their own privacy policies and available ad controls.', 'AudioLift does not sell your media files. You are responsible for having permission to process the media you select.']
    : ['AudioLift is provided free and “as is”, without warranties.', 'Only process videos you own or have permission to use.', 'AudioLift does not download videos from third-party platforms.', 'Very large files may fail depending on your device and browser.', 'We may change or discontinue the service at any time.'];
  return (<><main className="mx-auto max-w-3xl px-4 py-16"><a href="/" className="text-indigo-700 underline">← Back to AudioLift</a>
    <h1 className="mt-4 text-4xl font-extrabold">{priv ? 'Privacy Policy' : 'Terms of Use'}</h1>
    <ul className="mt-6 list-disc space-y-3 pl-5 text-stone-700">{items.map((t) => <li key={t}>{t}</li>)}</ul>
    <p className="mt-6 text-sm text-stone-500">Last updated: September 27, 2026. For questions, use the <a className="underline" href="/contact">Contact page</a>.</p></main><Footer /></>);
}

function Contact() {
  return <><main className="mx-auto max-w-3xl px-4 py-16"><a href="/" className="text-indigo-700 underline">← Back to AudioLift</a>
    <h1 className="mt-4 text-4xl font-extrabold">Contact AudioLift</h1>
    <p className="mt-4 text-stone-700">Need help, found a bug, or have a copyright concern? Send a message through the project’s support form. Please do not attach private media files.</p>
    <a className="btn-p mt-6" href="https://github.com/timefusionsidk/audiolift/issues/new" target="_blank" rel="noreferrer">Contact project support</a>
    <h2 className="mt-10 text-2xl font-bold">Before you contact us</h2>
    <ul className="mt-3 list-disc space-y-2 pl-5 text-stone-700"><li>Include your browser, device type, video format, and the error message.</li><li>Do not share copyrighted or sensitive video content.</li><li>For conversion problems, try a smaller file or a different output format first.</li></ul>
  </main><Footer /></>;
}

export default function App() {
  const p = location.pathname.replace(/\/$/, '');
  if (p === '/privacy' || p === '/terms') return <Legal kind={p.slice(1) as 'privacy' | 'terms'} />;
  if (p === '/contact') return <Contact />;
  return <Home />;
}
