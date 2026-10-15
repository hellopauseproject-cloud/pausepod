import { supabase } from './supabase';

/**
 * Att göra-listan — lappen på Hem och kretsens lappar.
 *
 * Raderna är `wishlist_items` (supabase/wishlist.sql): tabellen och dess namn
 * står kvar från när punkterna hette "On my list", samma linje som att
 * `support_*` behöll sina namn när orden i UI:t byttes. Egna punkter skrivs
 * direkt mot tabellen (RLS: bara ens egna), att bocka av går genom
 * `complete_wishlist_item` så att kretsens flöde får sin rad.
 *
 * Kretskamrater läser varandras listor direkt mot tabellen; det är policyn
 * `shares_circle_with` i wishlist.sql som släpper igenom dem. Vänner gör det
 * inte (se components/todo-sheet.tsx).
 */

/** Hur länge en avbockad punkt syns kvar — hos en själv och i kretsen. */
export const DONE_VISIBLE_DAYS = 7;

export type Todo = {
  id: string;
  user_id: string;
  text: string;
  done_at: string | null;
  /** Ögat med streck: punkten syns bara för en själv, inte för kretsen. */
  hidden_from_circle: boolean;
  created_at: string;
};

const COLUMNS = 'id, user_id, text, done_at, hidden_from_circle, created_at';

const doneSince = () =>
  new Date(Date.now() - DONE_VISIBLE_DAYS * 24 * 3600 * 1000).toISOString();

/**
 * Öppna punkter plus de som bockats av den senaste veckan. Allt äldre ligger
 * kvar i databasen men visas inte: en lista som växer för alltid med gamla
 * bockar är en logg, inte en lista.
 */
async function readTodos(userIds: string[]): Promise<Todo[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('wishlist_items')
    .select(COLUMNS)
    .in('user_id', userIds)
    .or(`done_at.is.null,done_at.gte.${doneSince()}`)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Todo[];
}

export async function getTodos(userId: string): Promise<Todo[]> {
  return readTodos([userId]);
}

/** Hela kretsens punkter, en fråga för alla medlemmar. */
export async function getCircleTodos(memberIds: string[]): Promise<Todo[]> {
  return readTodos(memberIds);
}

export async function addTodo(userId: string, text: string): Promise<Todo> {
  const clean = text.trim();
  if (!clean) throw new Error('Write something first.');
  const { data, error } = await supabase
    .from('wishlist_items')
    .insert({ user_id: userId, text: clean })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Todo;
}

export async function completeTodo(id: string): Promise<void> {
  const { error } = await supabase.rpc('complete_wishlist_item', { p_item_id: id });
  if (error) throw new Error(error.message);
}

/**
 * Ångra en bock. Direkt mot tabellen, för RPC:n finns bara åt ena hållet.
 * Kretsflödets rad står kvar — flödet har inget sätt att ta tillbaka något,
 * och en bock som ångras är sällsynt nog att inte vara värd ett.
 */
export async function reopenTodo(id: string): Promise<void> {
  // `.select('id')` räknar ändrade rader: RLS som nekar ger inget fel i
  // PostgREST, bara noll rader (samma fälla som i lib/pauseTags.ts).
  const { data, error } = await supabase
    .from('wishlist_items')
    .update({ done_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Could not update that item.');
}

/**
 * Dölj en punkt för kretsen, eller visa den igen. Policyn i wishlist.sql gör
 * resten: kretskamraterna får helt enkelt inte raden.
 */
export async function setTodoHidden(id: string, hidden: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .update({ hidden_from_circle: hidden, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Could not update that item.');
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Senast avbockad först. */
export function sortDone(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) =>
    new Date(b.done_at ?? 0).getTime() - new Date(a.done_at ?? 0).getTime());
}

/** "just now", "3h ago", "yesterday", "4 days ago". */
export function doneAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
