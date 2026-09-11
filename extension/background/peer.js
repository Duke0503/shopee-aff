import { dispatch } from './dispatch.js';
import { uid } from './uid.js';
import { base_url as base, bridge_token } from './base_url.js';
import { create_job_scheduler } from './job_scheduler/create_job_scheduler.js';

let polling = false;

function with_timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function post_result(id, result) {
  try {
    await fetch(`${base}/result/${id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': bridge_token,
      },
      body: JSON.stringify(result),
    });
  } catch (e) {
    console.error('[cashback] result post failed:', e);
  }
}

async function run_job(job) {
  const timeout = Math.max(1000, Number(job.timeout_ms ?? 120_000) || 120_000);
  try {
    const value = await with_timeout(
      dispatch(job.connector, job.action, job.params ?? {}),
      timeout + 2000,
      `job_timeout:${job.connector}.${job.action}`
    );
    await post_result(job.id, { ok: true, value: value ?? null });
  } catch (e) {
    await post_result(job.id, { ok: false, error: e.message });
    console.error('[cashback] job error:', job.action, e);
  }
}

const job_scheduler = create_job_scheduler({
  concurrency: 4,
  run_job,
});

async function poll() {
  if (polling) return;
  polling = true;
  try {
    await uid.ready;
    while (true) {
      try {
        const url = uid.value ? `${base}/job?instance=${uid.value}` : `${base}/job`;
        const resp = await fetch(url, {
          headers: { 'X-Bridge-Token': bridge_token },
          signal: AbortSignal.timeout(26000),
        });
        if (resp.status === 200) {
          const job = await resp.json();
          void job_scheduler.enqueue(job).catch(e => {
            console.error('[cashback] scheduler error:', job?.action, e);
          });
        }
      } catch {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } finally {
    polling = false;
  }
}

// Keep service worker alive: alarm fires every 20s to re-trigger poll if it died
chrome.alarms.create('keepalive', { delayInMinutes: 0, periodInMinutes: 1 / 3 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'keepalive') poll(); });

poll();
