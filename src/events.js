import { EventEmitter } from 'node:events';

/** Process-wide event bus. Everything the UI shows live (streaming text, tool calls,
 *  approvals, channel messages, scheduled runs) flows through here. */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export function emit(type, data = {}) {
  bus.emit('event', { type, ts: Date.now(), ...data });
}

export function log(scope, ...args) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${scope}:`, ...args);
}
