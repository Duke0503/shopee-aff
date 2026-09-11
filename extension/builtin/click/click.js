export const tabless = false;
import { exec } from '../../background/exec.js';
import { cdp }  from '../../background/cdp.js';

export async function click(tab, { selector, x, y }) {
  if (x != null && y != null) {
    await cdp.attach(tab.id);
    try {
      await cdp.send(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved',   x, y, button: 'none' });
      await cdp.send(tab.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } finally {
      await cdp.detach(tab.id);
    }
    return { clicked: true };
  }
  const found = await exec(tab.id, sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  return { clicked: found };
}
