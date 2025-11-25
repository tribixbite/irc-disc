import events from 'events';

class ClientStub extends events.EventEmitter {
  nick;
  readyState = 'open';
  constructor(...args) {
    super();
    this.nick = args[1];
  }

  connect() {}
  disconnect() {}

  say() {}
  send() {}
  join() {}
}

export default ClientStub;
