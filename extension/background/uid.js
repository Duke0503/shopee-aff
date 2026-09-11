let _resolve;
export const uid = {
  value: null,
  ready: new Promise(r => { _resolve = r; }),
  set(id) { this.value = id; _resolve(id); },
};
