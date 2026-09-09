export const REFRESH_MARGIN_MS = 5 * 60_000;

export function createTokenManager({ mint, now = Date.now }) {
  let cached;
  let pending;
  let refreshes = 0;
  return {
    async get() {
      if (cached && Date.parse(cached.expires_at) - now() > REFRESH_MARGIN_MS) return cached;
      pending ??= Promise.resolve().then(mint).then((value) => {
        if (typeof value?.token !== 'string' || !value.token || /\s/.test(value.token)
            || !(Date.parse(value.expires_at) - now() > REFRESH_MARGIN_MS)) {
          throw new Error('Minted token has insufficient remaining lifetime.');
        }
        cached = value; refreshes += 1; return cached;
      }).finally(() => { pending = undefined; });
      return pending;
    },
    status() {
      return { ready: Boolean(cached && Date.parse(cached.expires_at) - now() > REFRESH_MARGIN_MS), refreshes };
    },
  };
}
