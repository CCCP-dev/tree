(() => {
  'use strict';

  const dialog = document.querySelector('#empty-state');
  const branches = document.querySelectorAll('[data-branch]');

  if (!dialog || branches.length === 0) return;

  const emptyName = dialog.querySelector('[data-empty-name]');
  const closeControl = dialog.querySelector('[data-dialog-close]');
  let fallbackTrigger = null;

  function closeDialog() {
    if (dialog.classList.contains('is-fallback-visible')) {
      dialog.removeAttribute('open');
      dialog.classList.remove('is-fallback-visible');
      dialog.removeAttribute('role');
      dialog.removeAttribute('aria-modal');

      if (fallbackTrigger && typeof fallbackTrigger.focus === 'function') {
        fallbackTrigger.focus();
      }
      fallbackTrigger = null;
    } else if (typeof dialog.close === 'function') {
      dialog.close();
    }
  }

  function showPending(branchName, trigger) {
    if (emptyName) emptyName.textContent = branchName;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      fallbackTrigger = trigger;
      dialog.setAttribute('open', '');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.classList.add('is-fallback-visible');
      if (closeControl && typeof closeControl.focus === 'function') closeControl.focus();
    }
  }

  branches.forEach((branch) => {
    branch.addEventListener('click', () => {
      if (branch.dataset.branch === 'army') {
        window.location.href = '陆军.html';
        return;
      }

      showPending(branch.dataset.branch === 'navy' ? '海军' : '空军', branch);
    });
  });

  if (closeControl) closeControl.addEventListener('click', closeDialog);
})();
