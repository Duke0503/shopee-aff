function queue_key(job) {
  const connector = String(job?.connector ?? '_').trim() || '_';
  const tab_scope = String(job?.params?._tab_scope ?? '').trim();
  return `${connector}:${tab_scope || '__unscoped__'}`;
}

export function create_job_scheduler({ run_job, concurrency = 4 } = {}) {
  if (typeof run_job !== 'function') throw new TypeError('run_job must be a function');

  const max_concurrency = Math.max(1, Number(concurrency) || 1);
  const queues = new Map();
  const active_keys = new Set();
  const idle_waiters = [];
  let active_count = 0;

  function is_idle() {
    return active_count === 0 && queues.size === 0;
  }

  function notify_idle() {
    if (!is_idle()) return;
    while (idle_waiters.length) idle_waiters.shift()();
  }

  function next_queue() {
    for (const [key, queue] of queues) {
      if (queue.length && !active_keys.has(key)) return [key, queue];
    }
    return null;
  }

  function schedule() {
    while (active_count < max_concurrency) {
      const entry = next_queue();
      if (!entry) break;

      const [key, queue] = entry;
      const task = queue.shift();
      active_keys.add(key);
      active_count += 1;

      Promise.resolve()
        .then(() => run_job(task.job))
        .then(task.resolve, task.reject)
        .finally(() => {
          active_count -= 1;
          active_keys.delete(key);
          if (queue.length) {
            queues.delete(key);
            queues.set(key, queue);
          } else {
            queues.delete(key);
          }
          schedule();
          notify_idle();
        });
    }
  }

  function enqueue(job) {
    return new Promise((resolve, reject) => {
      const key = queue_key(job);
      const queue = queues.get(key) ?? [];
      queue.push({ job, resolve, reject });
      queues.set(key, queue);
      schedule();
    });
  }

  function wait_for_idle() {
    if (is_idle()) return Promise.resolve();
    return new Promise(resolve => idle_waiters.push(resolve));
  }

  function stats() {
    let queued_count = 0;
    for (const queue of queues.values()) queued_count += queue.length;
    return { active_count, queued_count, scope_count: queues.size };
  }

  return { enqueue, wait_for_idle, stats };
}
