export const tabless = false;
import { exec } from '../../background/exec.js';
import { cdp }  from '../../background/cdp.js';

// selector is optional -- if omitted, types at the currently focused element.
// Uses Input.dispatchKeyEvent (not insertText) so it fires keydown/beforeinput/keyup
// with isTrusted:true, which rich-text editors commonly require.
export async function type(tab, { selector, text }) {
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  if (selector) {
    await exec(tab.id, sel => { document.querySelector(sel)?.focus(); }, selector);
  }
  await cdp.attach(tab.id);
  try {
    for (const char of text) {
      if (char === '\n') {
        await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      } else {
        await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'char', text: char });
      }
    }
  } finally {
    await cdp.detach(tab.id);
  }
  return { ok: true };
}
