import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  /** Office mailbox the user signed in through, if not their own email. */
  actorVia: string | null
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}
