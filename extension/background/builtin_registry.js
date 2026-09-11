// Command registry. Add a file under builtin/ and register it here.
//
// BUILTINS take a resolved tab as their first argument.
// TABLESS operate on the browser as a whole and take only params.
import { click } from '../builtin/click/click.js';
import { execute_script } from '../builtin/execute_script/execute_script.js';
import { navigate } from '../builtin/navigate/navigate.js';
import { navigate_execute } from '../builtin/navigate_execute/navigate_execute.js';
import { network_capture } from '../builtin/network_capture/network_capture.js';
import { request } from '../builtin/request/request.js';
import { screenshot } from '../builtin/screenshot/screenshot.js';
import { send_keys } from '../builtin/send_keys/send_keys.js';
import { type } from '../builtin/type/type.js';
import { upload_file } from '../builtin/upload_file/upload_file.js';
import { close_tab } from '../builtin/close_tab/close_tab.js';
import { fetch_bg } from '../builtin/fetch_bg/fetch_bg.js';
import { get_tabs } from '../builtin/get_tabs/get_tabs.js';
import { quit } from '../builtin/quit/quit.js';
import { reload } from '../builtin/reload/reload.js';
import { switch_tab } from '../builtin/switch_tab/switch_tab.js';

export const BUILTINS = {
  click, execute_script, navigate, navigate_execute, network_capture,
  request, screenshot, send_keys, type, upload_file,
};
export const TABLESS = { close_tab, fetch_bg, get_tabs, quit, reload, switch_tab };
