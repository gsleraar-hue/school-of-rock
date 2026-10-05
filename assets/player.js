/* Gedeelde speler: één fragment tegelijk, met een balk onderin het scherm. */
(function () {
  const ROOT = document.querySelector('meta[name="sor-root"]')?.content || '.';
  const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const norm = s => slug(s).replace(/-/g, '');

  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  const listeners = new Set();

  const bar = document.createElement('div');
  bar.className = 'sor-player';
  bar.hidden = true;
  bar.innerHTML = `
    <button class="sp-toggle" type="button" aria-label="Pauzeer"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M7 5h3v14H7zM14 5h3v14h-3z"/><path class="i-play" d="M8 5l11 7-11 7z"/></svg></button>
    <img class="sp-cover" alt="" hidden onerror="this.hidden=true">
    <div class="sp-meta"><span class="sp-artist"></span><span class="sp-title"></span><div class="sp-bar"><i></i></div></div>
    <span class="sp-tag mono">fragment · 30 s</span>
    <button class="sp-close" type="button" aria-label="Sluit speler">×</button>`;
  const css = document.createElement('style');
  css.textContent = `
    .sor-player{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:80;width:min(560px,calc(100% - 24px));display:flex;align-items:center;gap:12px;padding:8px 10px 8px 8px;background:#1C1B19;color:#fff;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.35);border-left:5px solid #F2D500;font-family:Inter,Segoe UI,Arial,sans-serif}
    .sor-player[hidden]{display:none}
    .sor-player .sp-toggle{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:#D63A31;color:#fff;display:grid;place-items:center;cursor:pointer}
    .sor-player .sp-toggle svg{width:18px;height:18px;fill:currentColor}
    .sor-player .sp-toggle .i-play{display:none}.sor-player.paused .i-play{display:block}.sor-player.paused .i-pause{display:none}
    .sor-player .sp-cover{width:40px;height:40px;border-radius:2px;object-fit:cover;background:#2A2825}
    .sor-player .sp-cover[hidden]{display:none}
    .sor-player .sp-meta{flex:1;min-width:0;display:grid;gap:2px;font-size:13px;line-height:1.25}
    .sor-player .sp-artist{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sor-player .sp-title{color:#CFCAC0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sor-player .sp-bar{height:3px;background:#3A3833;border-radius:2px;margin-top:4px;overflow:hidden}.sor-player .sp-bar i{display:block;height:100%;width:0;background:#F2D500}
    .sor-player .sp-tag{font:10px/1 "Space Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:#9C978D;white-space:nowrap}
    .sor-player .sp-close{flex:none;border:0;background:none;color:#9C978D;font-size:22px;cursor:pointer;padding:0 4px}
    @media (max-width:520px){.sor-player .sp-tag{display:none}}
    .sor-play{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;border:0;background:#D63A31;color:#fff;cursor:pointer;flex:none;vertical-align:middle}
    .sor-play svg{width:12px;height:12px;fill:currentColor}
    .sor-play.on{background:#1C1B19;color:#F2D500}`;
  document.head.appendChild(css);
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));

  const $ = s => bar.querySelector(s);
  function paint() {
    bar.classList.toggle('paused', audio.paused);
    listeners.forEach(fn => fn(current, !audio.paused));
  }
  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  audio.addEventListener('ended', () => { paint(); listeners.forEach(fn => fn(current, false, true)); });
  audio.addEventListener('timeupdate', () => { $('.sp-bar i').style.width = (audio.duration ? (100 * audio.currentTime / audio.duration) : 0) + '%'; });
  bar.addEventListener('click', e => {
    if (e.target.closest('.sp-toggle')) { audio.paused ? audio.play() : audio.pause(); }
    if (e.target.closest('.sp-close')) { audio.pause(); bar.hidden = true; }
  });

  const SOR = window.SOR = {
    slug, norm, root: ROOT,
    play(track) {
      if (!track || !track.audio) return;
      if (current && current.audio === track.audio) { audio.paused ? audio.play() : audio.pause(); return; }
      current = track;
      audio.src = track.audio;
      $('.sp-artist').textContent = track.artist || '';
      $('.sp-title').textContent = [track.title, track.year].filter(Boolean).join(' · ');
      { const im = $('.sp-cover'); if (track.cover) { im.src = track.cover; im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; } }
      bar.hidden = false;
      audio.play().catch(() => paint());
    },
    stop() { audio.pause(); },
    isPlaying(track) { return !!(current && track && current.audio === track.audio && !audio.paused); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    playIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
    pauseIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>',
    load(path) { return fetch(ROOT + '/' + path).then(r => r.json()); }
  };
})();
