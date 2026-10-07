import { rid } from './util.mjs';
/** Append-only audit log. Nothing in the app updates or deletes audit rows. */
export function createAudit({ store, clock }) {
  return {
    /** @param {{actor:string,role?:string,kind:string,target?:string,summary:string,ip?:string,meta?:object}} e */
    async write(e) {
      const at = clock.now();
      const id = `${String(at).padStart(13, '0')}-${rid(3)}`;
      const row = { id, at, actor: e.actor ?? 'system', role: e.role ?? 'system', kind: e.kind, target: e.target ?? '', summary: String(e.summary ?? '').slice(0, 500), ip: e.ip, meta: e.meta };
      await store.set('audit', id, row);
      return row;
    },
  };
}
