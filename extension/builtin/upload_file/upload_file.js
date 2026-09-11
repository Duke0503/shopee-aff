export const tabless = false;
import { cdp } from '../../background/cdp.js';

// Fill a <input type="file"> via CDP without a native picker.
//
// Two modes:
//  - selector      -> a PERSISTENT input already in the DOM (classic consumer composers).
//  - trigger {x,y} -> the input is TRANSIENT: it only exists for the moment the page's own
//    handler runs `input.click()` (e.g. Meta Business Suite "Add photo/video"). A trusted
//    click at {x,y} opens the file chooser; with Page.setInterceptFileChooserDialog enabled
//    that surfaces as Page.fileChooserOpened carrying the input's backendNodeId, which we
//    fill directly -- no persistent node ever appears in the DOM.
export async function upload_file(tab, { selector, path, paths, trigger, tabid }) {
  if (tabid != null) tab = await chrome.tabs.get(Number(tabid));
  const files = [...(Array.isArray(paths) ? paths : []), ...(path ? [path] : [])].filter(Boolean);
  await cdp.attach(tab.id);
  try {
    if (trigger && trigger.x != null && trigger.y != null) {
      return await upload_via_chooser(tab.id, trigger, files);
    }
    if (!files.length) return { ok: false, error: 'no files' };
    const { root }   = await cdp.send(tab.id, 'DOM.getDocument', {});
    const { nodeId } = await cdp.send(tab.id, 'DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return { ok: false, error: 'element not found' };
    await cdp.send(tab.id, 'DOM.setFileInputFiles', { nodeId, files });
    return { ok: true, count: files.length };
  } finally {
    await cdp.detach(tab.id);
  }
}

async function upload_via_chooser(tabId, { x, y }, files) {
  if (!files.length) return { ok: false, error: 'no files' };
  await cdp.send(tabId, 'Page.enable', {});
  await cdp.send(tabId, 'DOM.enable', {});
  // Chrome suppresses a file chooser unless the page is focused -- force it foreground first,
  // otherwise the trusted click lands but no Page.fileChooserOpened ever fires.
  try { await cdp.send(tabId, 'Page.bringToFront', {}); } catch { /* ignore */ }
  await cdp.send(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
  let chooser = null;
  const on_chooser = (p) => { if (chooser == null) chooser = p; };
  cdp.on(tabId, 'Page.fileChooserOpened', on_chooser);
  try {
    // Trusted click -> the composer's own onClick fires input.click() -> intercepted chooser.
    await cdp.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved',   x, y, button: 'none' });
    await cdp.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await new Promise(r => setTimeout(r, 60));
    await cdp.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
    const deadline = Date.now() + 8000;
    while (chooser == null && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    if (chooser == null) return { ok: false, error: 'file chooser did not open' };
    if (chooser.backendNodeId == null) return { ok: false, error: 'chooser had no backendNodeId' };
    await cdp.send(tabId, 'DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files });
    return { ok: true, method: 'file_chooser', count: files.length };
  } finally {
    cdp.off(tabId, 'Page.fileChooserOpened', on_chooser);
    try { await cdp.send(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch { /* ignore */ }
  }
}
