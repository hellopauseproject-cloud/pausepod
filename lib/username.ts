import { supabase } from './supabase';

/**
 * Namnet är upptaget — en enda formulering, delad av registreringen,
 * introduktionen och profilskärmen.
 *
 * Skalet i databasen (`profiles_username_lower_key`, se
 * [supabase/usernames.sql](../supabase/usernames.sql)) är skiftlägesokänsligt:
 * `Maja` är upptaget om `maja` finns. Meddelandet säger därför "taken" och
 * inte "already exists" — det senare hade inbjudit till att prova samma namn
 * med en versal.
 */
export const USERNAME_TAKEN_MESSAGE = 'That username is taken. Try another one.';

/**
 * Är det här ett fel om ett upptaget namn?
 *
 * `23505` är Postgres kod för unique_violation och räcker på de ställen där
 * namnet är det enda unika i skrivningen — vilket det är i alla tre
 * anropen: `profiles` har bara två unika skal kvar, primärnyckeln och det
 * här, och primärnyckeln kan inte krocka i en `update` på den egna raden.
 * Namnkontrollen finns ändå med som bälte och hängslen för klienter som får
 * felet utan kod.
 */
export function isUsernameTakenError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('profiles_username');
}

/**
 * Är namnet ledigt?
 *
 * Går via `username_available`, en `security definer`-RPC utdelad även till
 * `anon`: frågan måste kunna ställas av den som ännu inte har något konto,
 * och `profiles` går inte att läsa utan session.
 *
 * **`null` betyder "vet inte", och är inte samma sak som `false`.** Ett brutet
 * nät ska inte kunna låsa någon ute från ett namn som är ledigt — den som får
 * `null` ska fortsätta och låta skrivningen avgöra. Skalet i databasen är den
 * riktiga grinden; det här är bara den vänliga varningen före den.
 */
export async function isUsernameAvailable(name: string): Promise<boolean | null> {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const { data, error } = await supabase.rpc('username_available', { p_name: trimmed });
  if (error) {
    console.log('[username] kunde inte kontrollera namnet:', error.message);
    return null;
  }
  return data === true;
}
