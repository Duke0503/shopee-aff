import { find_tab }          from './find_tab/find_tab.js';
import { BUILTINS, TABLESS } from './builtin_registry.js';
import { scoped_tab_id }     from './find_tab/scoped_tab_id/scoped_tab_id.js';

export async function dispatch(connector_id, action, params) {
  const tabless = TABLESS[action];
  if (tabless) return tabless(params);

  const { _routing, _tab_scope, ...rest } = params;

  // Explicit tabid override: target a specific tab directly, bypassing host-based find_tab.
  // Used by tooling/debug drivers that must operate on one exact tab and
  // never route through a connector's pinned tab. Honored centrally so every tab-based builtin
  // (execute_script, screenshot, upload_file, network_capture, ...) respects it.
  const tab = rest.tabid != null
    ? await chrome.tabs.get(Number(rest.tabid))
    : await (async () => {
        if (!_routing?.hosts) throw new Error(`No routing info for connector: ${connector_id}`);
        return find_tab(
          scoped_tab_id(connector_id, _tab_scope),
          _routing.hosts,
          _routing.url,
          { recover_existing: !_tab_scope },
        );
      })();

  const builtin = BUILTINS[action];
  if (builtin) return builtin(tab, rest);

  throw new Error(`Unknown action: ${action} for connector: ${connector_id}`);
}
