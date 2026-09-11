export const tabless = false;
import { navigate as navto } from '../../background/navigate.js';
import { execute_script } from '../execute_script/execute_script.js';

export async function navigate_execute(tab, { url, wait = 800, code, _job_timeout_ms }) {
  await navto(tab.id, url, wait);
  return execute_script(tab, { code, _job_timeout_ms });
}
