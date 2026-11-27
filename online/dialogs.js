'use strict';
(() => {
  let queue = Promise.resolve();
  function open(kind, message) {
    const result = queue.then(() => new Promise(resolve => {
      const previous = document.activeElement;
      const overlay = document.createElement('div'); overlay.className = 'modal-backdrop quadra-dialog';
      overlay.innerHTML = '<form class="modal" role="dialog" aria-modal="true" aria-labelledby="quadra-dialog-title"><div class="modal-head"><h2 id="quadra-dialog-title"></h2></div><p class="explain" data-dialog-message></p><label class="field" data-dialog-field hidden><span>Conferma richiesta</span><input data-dialog-input autocomplete="off"></label><div class="backup-actions"><button class="btn" type="button" data-dialog-cancel>Annulla</button><button class="btn primary" type="submit" data-dialog-confirm>Conferma</button></div></form>';
      overlay.querySelector('h2').textContent = kind === 'alert' ? 'Quadra' : kind === 'prompt' ? 'Conferma il ripristino' : 'Conferma operazione';
      overlay.querySelector('[data-dialog-message]').textContent = message;
      const input = overlay.querySelector('[data-dialog-input]'), cancel = overlay.querySelector('[data-dialog-cancel]');
      overlay.querySelector('[data-dialog-field]').hidden = kind !== 'prompt';
      cancel.hidden = kind === 'alert';
      if (kind === 'alert') overlay.querySelector('[data-dialog-confirm]').textContent = 'Ho capito';
      const close = value => { overlay.remove(); previous?.focus(); resolve(value); };
      cancel.onclick = () => close(kind === 'prompt' ? null : false);
      overlay.querySelector('form').onsubmit = event => {event.preventDefault(); close(kind === 'prompt' ? input.value : true);};
      overlay.addEventListener('keydown',event => {
        if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();close(kind === 'prompt' ? null : false);}
        if (event.key === 'Tab') {
          const nodes = [...overlay.querySelectorAll('input,button')].filter(node => !node.hidden && !node.closest('[hidden]'));
          const first = nodes[0], last = nodes.at(-1);
          if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
          else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
        }
      });
      document.body.append(overlay); (kind === 'prompt' ? input : cancel.hidden ? overlay.querySelector('[data-dialog-confirm]') : cancel).focus();
    }));
    queue = result.catch(() => {}); return result;
  }
  window.QuadraDialog = {confirm:message => open('confirm',message),alert:message => open('alert',message),prompt:message => open('prompt',message)};
})();
