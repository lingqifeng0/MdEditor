export class StudyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'StudyError'
  }
}

export function current(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StudyError('CANCELLED', '回看操作已取消。')
}

export function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  current(signal)
  return new Promise((resolve, reject) => {
    const finish = (): void => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new StudyError('CANCELLED', '回看操作已取消。'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
