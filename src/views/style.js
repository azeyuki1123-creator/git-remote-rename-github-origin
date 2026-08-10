export const STYLE = `
:root {
  --bg: #f6f5f2;
  --panel: #ffffff;
  --ink: #1c1b19;
  --muted: #6b6862;
  --line: #e2ded6;
  --accent: #8c1c13;
  --accent-soft: #f6e7e5;
  --ok: #1f7a4d;
  --warn: #a86400;
  --lock: #9a968e;
  --radius: 12px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16151a;
    --panel: #1e1d23;
    --ink: #ecebe8;
    --muted: #9b978f;
    --line: #33313a;
    --accent: #e05c4c;
    --accent-soft: #33211f;
    --ok: #56c08a;
    --warn: #d99a3a;
    --lock: #6c6a72;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  line-height: 1.7;
  -webkit-text-size-adjust: 100%;
}
a { color: var(--accent); }
header.top {
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 10;
}
.top-inner {
  max-width: 1080px; margin: 0 auto; padding: .6rem 1rem;
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
}
.brand { font-weight: 700; letter-spacing: .04em; text-decoration: none; color: var(--ink); }
.brand span { color: var(--accent); }
nav.main { display: flex; gap: .1rem; flex-wrap: wrap; margin-left: auto; }
nav.main a {
  text-decoration: none; color: var(--muted); padding: .3rem .55rem;
  border-radius: 999px; font-size: .88rem;
}
.who { display: flex; align-items: center; gap: .5rem; margin-left: auto; font-size: .85rem; white-space: nowrap; }
nav.main a:hover { background: var(--bg); color: var(--ink); }
nav.main a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
main { max-width: 1080px; margin: 0 auto; padding: 1.25rem 1rem 4rem; }
h1 { font-size: 1.5rem; margin: .2rem 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.6rem 0 .6rem; }
.sub { color: var(--muted); font-size: .9rem; margin-top: -.6rem; margin-bottom: 1rem; }
.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 1rem; margin-bottom: 1rem;
}
.grid { display: grid; gap: 1rem; }
.grid.cols-2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.grid.cols-3 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.grid.cols-4 { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.stat { text-align: left; }
.stat .n { font-size: 1.8rem; font-weight: 700; line-height: 1.2; }
.stat .l { color: var(--muted); font-size: .85rem; }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
.table-wrap { overflow-x: auto; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { color: var(--muted); font-weight: 600; font-size: .82rem; white-space: nowrap; }
tr:last-child td { border-bottom: none; }
.badge {
  display: inline-block; padding: .1rem .5rem; border-radius: 999px;
  font-size: .78rem; border: 1px solid var(--line); white-space: nowrap;
}
.badge.ok { color: var(--ok); border-color: var(--ok); }
.badge.warn { color: var(--warn); border-color: var(--warn); }
.badge.lock { color: var(--lock); border-color: var(--lock); }
.belt {
  display: inline-flex; align-items: center; gap: .35rem; font-size: .85rem; white-space: nowrap;
}
.belt i { width: 26px; height: 9px; border-radius: 2px; border: 1px solid rgba(0,0,0,.25); display: inline-block; }
form.inline { display: inline; }
label { display: block; font-size: .85rem; color: var(--muted); margin-bottom: .2rem; }
input, select, textarea {
  width: 100%; padding: .45rem .55rem; border: 1px solid var(--line);
  border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit;
}
textarea { min-height: 7rem; resize: vertical; }
.field { margin-bottom: .75rem; }
.row { display: flex; gap: .75rem; flex-wrap: wrap; align-items: flex-end; }
.row > .field { flex: 1 1 180px; margin-bottom: 0; }
button, .btn {
  display: inline-block; padding: .45rem .9rem; border-radius: 8px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff; font: inherit; cursor: pointer; text-decoration: none;
}
button.ghost, .btn.ghost { background: transparent; color: var(--accent); }
button.small, .btn.small { padding: .2rem .55rem; font-size: .82rem; }
.bar { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; }
.bar > i { display: block; height: 100%; background: var(--accent); }
.locked { opacity: .62; }
.flash { border-left: 3px solid var(--ok); padding: .5rem .8rem; background: var(--panel); border-radius: 8px; margin-bottom: 1rem; }
.flash.error { border-left-color: var(--accent); }
.muted { color: var(--muted); }
.right { text-align: right; }
.nowrap { white-space: nowrap; }
.chips { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: 1rem; }
.chips a { text-decoration: none; font-size: .85rem; padding: .2rem .7rem; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); }
.chips a.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.login-wrap { max-width: 380px; margin: 4rem auto; }
.stamp-card {
  display: grid; grid-template-columns: repeat(10, 1fr); gap: .3rem; margin: .6rem 0;
}
@media (max-width: 520px) { .stamp-card { grid-template-columns: repeat(6, 1fr); } }
.stamp-card i {
  aspect-ratio: 1; border-radius: 50%; border: 1px dashed var(--line);
  display: flex; align-items: center; justify-content: center;
  font-size: .8rem; font-style: normal; color: var(--lock);
}
.stamp-card i.on {
  border: 1px solid var(--accent); border-style: solid;
  background: var(--accent-soft); color: var(--accent); font-weight: 700;
}
.stamp-card i.new { box-shadow: 0 0 0 3px var(--accent-soft); }
.stamp-meta { display: flex; gap: 1.2rem; flex-wrap: wrap; align-items: baseline; }
.stamp-meta b { font-size: 1.4rem; }
video { width: 100%; border-radius: 8px; background: #000; }
.list-reset { list-style: none; padding: 0; margin: 0; }
.divider { height: 1px; background: var(--line); margin: 1rem 0; }
footer { max-width: 1080px; margin: 0 auto; padding: 0 1rem 2rem; color: var(--muted); font-size: .8rem; }
`;
