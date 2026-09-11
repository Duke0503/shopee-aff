// The local bridge. Loopback only -- this must never be a remote address.
// Port differs from other projects on this machine so two bridges can run
// side by side without fighting over a socket.
export const base_url = 'http://127.0.0.1:8787';

// Shared secret. Must match BRIDGE_TOKEN in the project's .env, otherwise the
// bridge rejects every request. Without it any local process, including a
// random web page, could drive this extension.
export const bridge_token = 'GENERATED-BY-cashback-setup-token';
