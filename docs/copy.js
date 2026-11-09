// Copy buttons next to each command.
(() => {
  const done = document.documentElement.lang === 'ko' ? '복사됨' : 'Copied';
  for (const btn of document.querySelectorAll('.copy button')) {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      const text = btn.parentElement.querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = done;
        setTimeout(() => { btn.textContent = label; }, 1500);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(btn.parentElement.querySelector('code'));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }
    });
  }
})();
