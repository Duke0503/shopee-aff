export const tabless = false;
import { cdp } from '../../background/cdp.js';

const KEYS = {
  Escape:    { key: 'Escape',     code: 'Escape',      windowsVirtualKeyCode: 27 },
  Tab:       { key: 'Tab',        code: 'Tab',          windowsVirtualKeyCode: 9  },
  Enter:     { key: 'Enter',      code: 'Enter',        windowsVirtualKeyCode: 13 },
  Space:     { key: ' ',          code: 'Space',        windowsVirtualKeyCode: 32 },
  Backspace: { key: 'Backspace',  code: 'Backspace',    windowsVirtualKeyCode: 8  },
  Delete:    { key: 'Delete',     code: 'Delete',       windowsVirtualKeyCode: 46 },
  ArrowUp:   { key: 'ArrowUp',    code: 'ArrowUp',      windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown',  code: 'ArrowDown',    windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft',  code: 'ArrowLeft',    windowsVirtualKeyCode: 37 },
  ArrowRight:{ key: 'ArrowRight', code: 'ArrowRight',   windowsVirtualKeyCode: 39 },
  Home:      { key: 'Home',       code: 'Home',         windowsVirtualKeyCode: 36 },
  End:       { key: 'End',        code: 'End',          windowsVirtualKeyCode: 35 },
  PageUp:    { key: 'PageUp',     code: 'PageUp',       windowsVirtualKeyCode: 33 },
  PageDown:  { key: 'PageDown',   code: 'PageDown',     windowsVirtualKeyCode: 34 },
};

function parse(combo) {
  const parts = combo.split('+');
  const name  = parts[parts.length - 1];
  let modifiers = 0;
  for (const p of parts.slice(0, -1)) {
    if (p === 'Ctrl')  modifiers |= 2;
    if (p === 'Shift') modifiers |= 8;
    if (p === 'Alt')   modifiers |= 1;
    if (p === 'Meta')  modifiers |= 4;
  }
  const def = KEYS[name] ?? {
    key: name, code: `Key${name.toUpperCase()}`,
    windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0),
  };
  return { ...def, modifiers };
}

export async function send_keys(tab, { key }) {
  const params = parse(key);
  if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await chrome.tabs.update(tab.id, { active: true });
  await cdp.attach(tab.id);
  try {
    await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp',   ...params });
  } finally {
    await cdp.detach(tab.id);
  }
  return { ok: true };
}
