const SERVICES = {
  'Fish Audio': { billing: 'https://fish.audio/app/billing/', keys: 'https://fish.audio/app/api-keys/' },
  OpenRouter: { billing: 'https://openrouter.ai/settings/credits', keys: 'https://openrouter.ai/settings/keys' },
};

function kindFor(status) {
  if (status === 402) return 'credits';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  return 'other';
}

/** An error from Fish Audio or OpenRouter that we can explain to the user in plain words. */
export class ServiceError extends Error {
  constructor(service, status, detail, kind = kindFor(status)) {
    super(`${service} ${status}: ${detail}`);
    this.service = service;
    this.status = status;
    this.kind = kind;
  }

  /** Builds the error for a request that failed before getting a response (timeout, network down). */
  static fromFetchError(service, err) {
    if (err.name === 'TimeoutError') return new ServiceError(service, 'timeout', 'no response in time', 'timeout');
    return new ServiceError(service, 'network', err.cause?.message ?? err.message);
  }

  /** Message shown in Discord. */
  get friendly() {
    const links = SERVICES[this.service];
    switch (this.kind) {
      case 'credits':
        return `⚠️ **${this.service} is out of credits**, so I can't answer right now. Top up at ${links.billing}`;
      case 'auth':
        return `⚠️ **${this.service} rejected the bot's API key.** Check the key in \`.env\` (${links.keys}).`;
      case 'rate':
        return `⏳ **${this.service} is rate limiting the bot.** Wait a moment and try again.`;
      case 'timeout':
        return `⏳ **${this.service} took too long to respond.** Try again in a moment.`;
      default:
        return `Something went wrong with ${this.service}: ${this.message}`;
    }
  }
}

// Only shout in the terminal once per problem every 10 minutes, so a busy server doesn't spam the log.
const lastWarned = new Map();

/** Prints a hard-to-miss warning in the bot's terminal for credit and API key problems. */
export function warnInTerminal(err) {
  if (!(err instanceof ServiceError) || (err.kind !== 'credits' && err.kind !== 'auth')) return;
  const key = `${err.service}:${err.kind}`;
  if (Date.now() - (lastWarned.get(key) ?? 0) < 10 * 60 * 1000) return;
  lastWarned.set(key, Date.now());

  const what = err.kind === 'credits' ? 'IS OUT OF CREDITS' : 'REJECTED THE API KEY';
  const link = err.kind === 'credits' ? SERVICES[err.service].billing : SERVICES[err.service].keys;
  const line = '!'.repeat(60);
  console.warn(`\n${line}\n  ${err.service.toUpperCase()} ${what}\n  ${link}\n  Details: ${err.message.slice(0, 200)}\n${line}\n`);
}
