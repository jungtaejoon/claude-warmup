// GitHub Actions setup helper: turns a peak time + gap choice into a workflow file and
// step-by-step links. Same window math as claude-warmup's peak mode (src/scheduler.js):
// the gap starts at peak + 5h·m, lasts 4h, and four 5-hour windows start at its end.
(() => {
  const KO = document.documentElement.lang === 'ko';
  const $ = (s) => document.querySelector(s);
  const DAY = 1440, WIN = 300, GAP = 240, EARLY = 3; // minutes; pings go out 3 min early (GitHub runs late, never early)
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (m) => `${pad(Math.floor(((m % DAY) + DAY) % DAY / 60))}:${pad(((m % DAY) + DAY) % DAY % 60)}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const offset = -new Date().getTimezoneOffset(); // minutes east of UTC, today
  const T = KO ? {
    gapOpt: (o, i) => `${i + 1}) ${hm(o.start)}–${hm(o.end)} ${['(피크 바로 뒤)', '', '', '', '(피크 바로 앞)'][i]}`,
    win: '창', gap: '빈 시간', peak: '피크',
    summary: (p, g, pings) => `피크 <b>${hm(p)}</b>에 리셋 · 빈 시간 <b>${hm(g.start)}–${hm(g.end)}</b> · 워밍업 <b>${pings.map(hm).join(', ')}</b> (각 ${EARLY}분 일찍 보내요)`,
    needUser: 'GitHub 아이디를 넣으면 버튼이 열려요',
    badUser: 'GitHub 아이디는 영문·숫자·하이픈만 써요',
    copied: '복사됨', copy: '복사',
    days: { everyday: '매일', weekdays: '평일만', weekends: '주말만' },
    head: '# claude-warmup (GitHub Actions판) · 이 파일은 설치 도우미가 만들었어요',
    remade: '# 설정을 바꾸려면 도우미 페이지에서 새로 만들어 이 파일 내용을 통째로 바꿔요',
    sent: '워밍업 보냄', newWin: '새 5시간 창이 시작됐다면 리셋은 약', already: '(이미 열린 창이 있었다면 그 창의 리셋 시각이 그대로예요)',
    noSecret: 'CLAUDE_CODE_OAUTH_TOKEN 비밀값이 없어요. 저장소 Settings → Secrets and variables → Actions 에서 넣어 주세요.',
    fail: 'Claude가 답하지 않았어요. 토큰이 만료됐거나 잘못 들어갔을 수 있어요.',
    usage: '사용량 (/usage)',
  } : {
    gapOpt: (o, i) => `${i + 1}) ${hm(o.start)}–${hm(o.end)} ${['(right after the peak)', '', '', '', '(right before the peak)'][i]}`,
    win: 'window', gap: 'gap', peak: 'peak',
    summary: (p, g, pings) => `Resets at your peak <b>${hm(p)}</b> · gap <b>${hm(g.start)}–${hm(g.end)}</b> · warmups at <b>${pings.map(hm).join(', ')}</b> (each sent ${EARLY} min early)`,
    needUser: 'Enter your GitHub username to unlock the buttons',
    badUser: 'GitHub usernames use letters, numbers and hyphens only',
    copied: 'Copied', copy: 'Copy',
    days: { everyday: 'Every day', weekdays: 'Weekdays only', weekends: 'Weekends only' },
    head: '# claude-warmup (GitHub Actions edition) · made by the setup helper',
    remade: '# To change settings, make a new file in the helper and replace this whole file',
    sent: 'Warmup sent', newWin: 'If this started a new 5-hour window, it resets at about', already: '(if a window was already open, its reset time stays the same)',
    noSecret: 'The CLAUDE_CODE_OAUTH_TOKEN secret is missing. Add it in the repository: Settings → Secrets and variables → Actions.',
    fail: 'Claude did not answer. The token may have expired or been pasted wrong.',
    usage: 'Usage (/usage)',
  };

  const gapOptions = (peak) => [0, 1, 2, 3, 4].map((m) => ({ m, start: (peak + m * WIN) % DAY, end: (peak + m * WIN + GAP) % DAY }));
  // the option whose gap holds 03:00, like the CLI's default suggestion
  const gapFor = (peak, at = 180) => gapOptions(peak).findIndex((o) => (at - o.start + DAY) % DAY < GAP);

  const st = { peak: 14 * 60, m: null, days: 'everyday', off: new Set(), user: '', repo: 'claude-warmup-runner' };
  st.m = gapFor(st.peak);

  const pings = () => { const g = gapOptions(st.peak)[st.m]; return [0, 1, 2, 3].map((k) => (g.end + k * WIN) % DAY); };

  function cronLines() {
    const dows = { everyday: null, weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] }[st.days];
    return pings().filter((p) => !st.off.has(p)).map((p) => {
      const local = (p - EARLY + DAY) % DAY, utc = local - offset, shift = Math.floor(utc / DAY), u = ((utc % DAY) + DAY) % DAY;
      const dow = dows ? [...new Set(dows.map((d) => (d + shift + 7) % 7))].sort().join(',') : '*';
      return `    - cron: '${u % 60} ${Math.floor(u / 60)} * * ${dow}'   # ${hm(local)} ${tz}`;
    });
  }

  function yaml() {
    const g = gapOptions(st.peak)[st.m];
    const lines = cronLines();
    return `${T.head}
# https://jungtaejoon.github.io/claude-warmup/${KO ? 'ko/' : ''}github-actions/
# peak ${hm(st.peak)} · gap ${hm(g.start)}-${hm(g.end)} · ${st.days} · ${tz} (UTC${offset >= 0 ? '+' : '-'}${hm(Math.abs(offset))})
${T.remade}
name: Claude warmup
on:
  schedule:
${lines.length ? lines.join('\n') : '    []'}
  workflow_dispatch:
permissions: {}
jobs:
  warmup:
    runs-on: ubuntu-latest
    timeout-minutes: 6
    env:
      TZ: ${tz}
      CLAUDE_CODE_OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    steps:
      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code --no-fund --no-audit --loglevel=error
      - name: Say hi (starts a new 5-hour window)
        run: |
          if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
            echo "::error::${T.noSecret}"
            exit 1
          fi
          sent=$(date '+%Y-%m-%d %H:%M')
          if ! out=$(timeout 120 claude -p --model haiku "hi" 2>&1); then
            echo "::error::${T.fail}"
            echo "$out" | head -20
            exit 1
          fi
          reset=$(date -d '+5 hours' '+%H:%M')
          {
            echo "### ✅ $sent ${T.sent}"
            echo "${T.newWin} **$reset** ${T.already}"
          } >> "$GITHUB_STEP_SUMMARY"
      - name: Usage (best effort)
        continue-on-error: true
        run: |
          u=$(timeout 60 claude -p "/usage" 2>&1 | head -40) || true
          {
            echo "<details><summary>${T.usage}</summary>"
            echo
            echo '\`\`\`'
            echo "$u"
            echo '\`\`\`'
            echo "</details>"
          } >> "$GITHUB_STEP_SUMMARY"
`;
  }

  function timeline() {
    const g = gapOptions(st.peak)[st.m], ps = pings(), segs = [];
    const add = (from, len, cls, label) => { // split at midnight
      const a = from % DAY;
      if (a + len <= DAY) segs.push([a, len, cls, label]);
      else { segs.push([a, DAY - a, cls, label]); segs.push([0, a + len - DAY, cls, '']); }
    };
    add(g.start, GAP, 'gapseg', T.gap);
    ps.forEach((p, i) => add(p, WIN, i % 2 ? 'win2' : 'win', st.off.has(p) ? '—' : `${hm(p)}→${hm(p + WIN)}`));
    const pct = (m) => (m / DAY) * 100;
    $('#tl').innerHTML = segs.map(([a, len, cls, label]) => `<div class="seg ${cls === 'gapseg' ? 'gapseg' : cls}" style="left:${pct(a)}%;width:${pct(len)}%">${label}</div>`).join('')
      + `<div class="peakmark" style="left:${pct(st.peak)}%" title="${T.peak}"></div>`;
    $('#tlSummary').innerHTML = T.summary(st.peak, g, ps);
  }

  function render() {
    const sel = $('#gap');
    sel.innerHTML = gapOptions(st.peak).map((o, i) => `<option value="${i}"${i === st.m ? ' selected' : ''}>${T.gapOpt(o, i)}</option>`).join('');
    $('#pingList').innerHTML = pings().map((p) => `<label class="chk"><input type="checkbox" data-p="${p}"${st.off.has(p) ? '' : ' checked'}> ${hm(p - EARLY)}</label>`).join('');
    timeline();
    const y = yaml();
    $('#yaml').textContent = y;
    const ok = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(st.user), repo = st.repo.replace(/[^A-Za-z0-9._-]/g, '') || 'claude-warmup-runner';
    $('#userNote').textContent = st.user && !ok ? T.badUser : ok ? '' : T.needUser;
    const base = `https://github.com/${st.user}/${repo}`;
    const links = {
      newRepo: `https://github.com/new?name=${encodeURIComponent(repo)}&visibility=private&description=${encodeURIComponent('claude-warmup (GitHub Actions)')}`,
      secret: `${base}/settings/secrets/actions/new`,
      file: `${base}/new/main?filename=${encodeURIComponent('.github/workflows/claude-warmup.yml')}&value=${encodeURIComponent(y)}`,
      edit: `${base}/edit/main/.github/workflows/claude-warmup.yml`,
      run: `${base}/actions/workflows/claude-warmup.yml`,
    };
    for (const [k, href] of Object.entries(links)) for (const a of document.querySelectorAll(`[data-link="${k}"]`)) {
      const needsUser = k !== 'newRepo';
      if (needsUser && !ok) { a.removeAttribute('href'); a.classList.add('off'); } else { a.href = href; a.classList.remove('off'); }
    }
  }

  $('#peak').addEventListener('input', (e) => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isFinite(h)) { st.peak = h * 60 + (m || 0); st.m = gapFor(st.peak); st.off.clear(); render(); } });
  $('#gap').addEventListener('change', (e) => { st.m = +e.target.value; st.off.clear(); render(); });
  $('#days').addEventListener('change', (e) => { st.days = e.target.value; render(); });
  $('#pingList').addEventListener('change', (e) => { const p = +e.target.dataset.p; if (e.target.checked) st.off.delete(p); else st.off.add(p); render(); });
  $('#user').addEventListener('input', (e) => { st.user = e.target.value.trim().replace(/^@/, ''); try { localStorage.setItem('cw-gh-user', st.user); } catch { /* fine */ } render(); });
  $('#repo').addEventListener('input', (e) => { st.repo = e.target.value.trim(); render(); });
  try { st.user = localStorage.getItem('cw-gh-user') || ''; $('#user').value = st.user; } catch { /* fine */ }
  $('#tzName').textContent = `${tz} (UTC${offset >= 0 ? '+' : '-'}${hm(Math.abs(offset))})`;
  $('#days').innerHTML = Object.entries(T.days).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  // copy buttons (commands, secret name, workflow file)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const src = document.querySelector(b.dataset.copy); const text = src.value ?? src.textContent;
    try { await navigator.clipboard.writeText(text); const l = b.textContent; b.textContent = T.copied; setTimeout(() => { b.textContent = l; }, 1500); }
    catch { const r = document.createRange(); r.selectNodeContents(src); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
  // OS tabs for the token step
  for (const t of document.querySelectorAll('[data-os]')) t.addEventListener('click', () => {
    for (const x of document.querySelectorAll('[data-os]')) x.setAttribute('aria-selected', String(x === t));
    for (const p of document.querySelectorAll('[data-ospane]')) p.hidden = p.dataset.ospane !== t.dataset.os;
  });
  if (/Win/i.test(navigator.platform || navigator.userAgent)) document.querySelector('[data-os="win"]')?.click();
  render();
})();
