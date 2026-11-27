'use strict';
(() => {
  const KEY = 'quadra-iphone-backup-pending';
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let active = false;
  function pending() { return active && localStorage.getItem(KEY) === 'yes'; }
  function show() {
    document.querySelector('.iphone-backup-reminder')?.remove();
    if (!pending()) return;
    const banner = document.createElement('aside'); banner.className = 'iphone-backup-reminder'; banner.setAttribute('role','status');
    banner.innerHTML = '<div><strong>Prima di chiudere, salva un backup</strong><p>Le ultime modifiche sono nel browser. Conserva una copia ZIP nell’app File.</p></div><div class="backup-actions"><button class="btn primary" type="button" data-iphone-export>Salva backup</button><button class="btn" type="button" data-iphone-confirm>Ho salvato il backup</button></div>';
    const main = document.querySelector('.main');
    if (main) main.prepend(banner);
  }
  function changed() {
    if (!isIOS()) return;
    localStorage.setItem(KEY,'yes'); show();
  }
  function enable() { active = isIOS(); show(); }
  function disable() { active = false; show(); }
  document.addEventListener('click',async event => {
    if (event.target.closest('[data-iphone-export]')) {
      await window.downloadFullBackup?.();
    }
    if (event.target.closest('[data-iphone-confirm]')) {
      if (!confirm('Hai salvato il backup delle ultime modifiche nell’app File?')) return;
      localStorage.removeItem(KEY); show();
    }
  });
  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState === 'visible') show();
  });
  window.QuadraIphoneBackup = {changed,enable,disable,show,pending};
})();
