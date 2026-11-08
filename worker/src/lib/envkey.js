// The Worker's per-request `env` is wrapped by the error-reporting tool (a new object every request),
// so a cache that asks "is this the same env object?" never matches. Caches key on the project instead.
// Tests start every mock environment with empty caches (resetCaches), so nothing leaks between them.
export const envKey = env => (env?.DB_BACKEND === 'supabase' ? `sb:${env.SUPABASE_URL || ''}` : String(env?.FIREBASE_PROJECT_ID || ''));
const resets = [];
export const onResetCaches = fn => { resets.push(fn); };
export const resetCaches = () => { for (const fn of resets) fn(); };
