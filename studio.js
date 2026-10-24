// Visual progress reflects the existing key lifecycle, without reading any key material.
(() => {
  const first = document.getElementById('step-card-1');
  const second = document.getElementById('step-card-2');
  const complete = document.getElementById('step-complete-box');
  const rail = document.querySelector('.studio-step-rail');
  if (!first || !second || !rail) return;
  const sync = () => {
    const ready = complete && complete.style.display !== 'none';
    const active = ready ? '3' : second.classList.contains('locked') ? '1' : '2';
    rail.querySelectorAll('li').forEach(item => {
      if (item.dataset.studioStep === active) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  };
  const observer = new MutationObserver(sync);
  observer.observe(second, { attributes:true, attributeFilter:['class'] });
  if (complete) observer.observe(complete, { attributes:true, attributeFilter:['style'] });
  document.querySelectorAll('.studio-more a').forEach(link => link.addEventListener('click', () => {
    document.querySelector('.studio-more').open = false;
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelector('.studio-more')?.removeAttribute('open');
  });
  sync();
})();
