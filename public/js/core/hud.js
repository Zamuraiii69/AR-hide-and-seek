export function setText(el, text) { el.textContent = text; }
export function setMode(root, mode) { root.dataset.mode = mode; }
export function setBusy(button, busy, label = 'Saving...') { button.disabled = busy; if (busy) { if (!('label' in button.dataset)) button.dataset.label = button.textContent; button.textContent = label; } else if ('label' in button.dataset) { button.textContent = button.dataset.label; delete button.dataset.label; } }
