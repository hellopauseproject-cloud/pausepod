let _active = false;
let _meta: { mode: string; category: string } | null = null;

export function isInboxActive(): boolean {
  return _active;
}

export function setInboxActive(
  active: boolean,
  meta?: { mode: string; category: string }
): void {
  _active = active;
  _meta = active ? (meta ?? null) : null;
}

export function getInboxMeta(): { mode: string; category: string } | null {
  return _meta;
}
