// The one place that decides how Khalfoun reaches Claude. Everything else (the session, the
// tools, the persona) is the same whichever way is used, so switching is a setting, not a rebuild.
//
//   subscription — the teacher's own Claude plan, signed in through Anthropic's own page with
//                  `claude auth login`. For his personal use only. Khalfoun never reads, keeps or
//                  passes on a sign-in token: Claude's program holds it.
//   apikey       — a Claude Console API key the teacher typed in settings (kept encrypted by
//                  secrets.js). The way to give Khalfoun to other teachers.

export const PROVIDERS = Object.freeze({
  subscription: { name: 'اشتراكي في Claude (Pro)', personalOnly: true },
  apikey: { name: 'مفتاح Claude API', personalOnly: false },
});

export function providerKind(settings) {
  return settings?.provider === 'apikey' ? 'apikey' : 'subscription';
}

/**
 * The environment Claude's program runs with.
 * @param {'subscription'|'apikey'} kind
 * @param {{apiKey?: string|null}} [creds]
 * @param {Record<string, string|undefined>} [base]
 */
export function providerEnv(kind, creds = {}, base = process.env) {
  const env = { ...base };
  // whatever the machine has set is never used by accident
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (kind === 'apikey') {
    const key = String(creds.apiKey || '').trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) return { ok: false, error: 'no_key', env };
    env.ANTHROPIC_API_KEY = key;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'khalfoun/3';
  env.DISABLE_AUTOUPDATER = '1';
  return { ok: true, env };
}

/** A gentle line for the teacher when the period's allowance is used up (the local layer keeps working). */
export function limitNotice(kind) {
  return kind === 'apikey'
    ? 'رصيد مفتاح Claude خلص. الأدوات السريعة شغّالة عادي.'
    : 'خلص رصيد Claude لهالفترة. المؤقت والطالب العشوائي والقلم وباقي الأدوات السريعة شغّالة عادي، وأرجع أفكر لما يتجدد الرصيد.';
}
