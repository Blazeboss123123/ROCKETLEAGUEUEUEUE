// MatchmakingService (in-process implementation).
//
// Interface used by the server:
//   place(conn, mode) -> session record   put a player into the best open public session
//   cancel(conn)                          player left before/while being placed
//   update()                              periodic housekeeping
//
// Strategy: fill an existing public lobby of the requested mode (or backfill a running match
// that currently has bots); otherwise open a new lobby. Lobbies start when every human is
// ready, or after the lobby timeout with remaining seats filled by bots. Because it is
// a single interface, a multi-server deployment can replace this with a service that talks to
// a shared queue (e.g. Redis) and allocates dedicated server processes — see README.

export class Matchmaker {
  constructor({ findOpen, create }) {
    this.findOpen = findOpen;
    this.create = create;
    this.placed = new WeakMap();
  }
  place(conn, mode) {
    const rec = this.findOpen(mode) || this.create(mode);
    this.placed.set(conn, rec);
    return rec;
  }
  cancel(conn) { this.placed.delete(conn); }
  update() { /* stateless placement; lobbies time out inside MatchHost */ }
}
