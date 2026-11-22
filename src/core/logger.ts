import type { Clock } from './clock';

export interface LogEvent {
  /** Order within the session. */
  seq: number;
  /** Milliseconds since the Unix epoch, from the game clock. */
  t: number;
  session: string;
  type: string;
  data?: Readonly<Record<string, unknown>>;
}

/** Where events are stored. */
export interface EventSink {
  append(event: LogEvent): Promise<void>;
  readAll(): Promise<LogEvent[]>;
}

export class MemorySink implements EventSink {
  readonly events: LogEvent[] = [];

  append(event: LogEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  readAll(): Promise<LogEvent[]> {
    return Promise.resolve([...this.events]);
  }
}

/**
 * The shared playtest logger. Every mini game and the runner send events here.
 * Writes happen in order in the background; `log` never blocks or throws.
 */
export class EventLogger {
  readonly session: string;
  readonly #sink: EventSink;
  readonly #clock: Clock;
  #seq = 0;
  #pending: Promise<void> = Promise.resolve();

  constructor(sink: EventSink, clock: Clock, session: string) {
    this.#sink = sink;
    this.#clock = clock;
    this.session = session;
  }

  log(type: string, data?: Readonly<Record<string, unknown>>): void {
    const event: LogEvent = { seq: this.#seq++, t: this.#clock.now(), session: this.session, type };
    if (data !== undefined) event.data = data;
    this.#pending = this.#pending
      .then(() => this.#sink.append(event))
      .catch((error: unknown) => {
        console.warn('Could not store log event', type, error);
      });
  }

  /** Resolves once every event logged so far has been stored. */
  flush(): Promise<void> {
    return this.#pending;
  }

  /** Every stored event from every session, oldest first. */
  async readAll(): Promise<LogEvent[]> {
    await this.flush();
    return this.#sink.readAll();
  }
}
