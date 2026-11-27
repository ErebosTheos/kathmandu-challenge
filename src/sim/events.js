export function createEvents() {
  const log = [];
  const subscribers = new Set();
  let sequence = 0;
  return {
    log,
    emit(type, time, details = {}) {
      const event = { ...details, id: ++sequence, type, time };
      log.push(event);
      for (const listener of subscribers) listener(event);
      return event;
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    since(id = 0) {
      return log.filter(event => event.id > id);
    },
  };
}
