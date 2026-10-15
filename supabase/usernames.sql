-- Användarnamn — kör i Supabase SQL-editorn.
-- Samma konvention som supabase/circles.sql och supabase/profiles_search.sql:
-- schemat bor här, inte i ett migrationsverktyg, och körs för hand. Allt är
-- idempotent.
--
-- ── Vad som gällde förut ────────────────────────────────────────────────────
--
-- `profiles.username` hade `unique (username)` och inget mer. Tre saker följde
-- av det:
--
--   1. **Skalet var byte-exakt.** Postgres jämför text skiftlägeskänsligt, så
--      `Maja`, `maja` och `MAJA` var tre olika värden och kunde finnas
--      samtidigt. Sökningen i profiles_search.sql matchar däremot med `ilike`
--      — alltså hade alla tre kommit tillbaka på samma sökning, i just de två
--      lägen där man väljer en människa på namnet: add-friend och
--      circle-invite.
--
--   2. **En krock vid registreringen sänkte hela registreringen.** Triggern
--      `on_auth_user_created` skapar profilraden, och dess insert saknade
--      undantagshantering: ett upptaget namn fick hela raden i `auth.users`
--      att rullas tillbaka. GoTrue rapporterar det som sitt generiska
--      "Database error saving new user", och den texten innehåller varken
--      "unique" eller "username" — alltså träffade inte heller det vänliga
--      felmeddelandet i AuthContext, och användaren fick databasens ord rakt
--      i ansiktet.
--
--   3. **Ingen kunde fråga i förväg.** Den som registrerar sig är inte
--      inloggad, och `profiles` går inte att läsa utan session. Namnet kunde
--      alltså bara testas genom att försöka skapa kontot.
--
-- De tre punkterna nedan svarar mot de tre problemen, i samma ordning.


-- ── 1. Skalet följer sökningen ──────────────────────────────────────────────
--
-- Unikt på `lower(username)`: ett namn är upptaget även om någon skriver det
-- med andra versaler. Det ursprungliga skalet blir överflödigt i och med
-- det — unikhet på den vikta formen medför unikhet på den exakta — och två
-- index för samma garanti är ett index för mycket.
--
-- Ordningen är avsiktlig: indexet skapas FÖRE det gamla skalet släpps. Finns
-- det redan krockar avbryter första satsen, och tabellen står kvar skyddad av
-- det gamla skalet i stället för att stå oskyddad efter ett halvkört skript.
-- (Krockar letas fram med:
--    select lower(username), count(*) from profiles
--    group by 1 having count(*) > 1;)

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

alter table public.profiles drop constraint if exists profiles_username_key;


-- ── 2. Registreringen får aldrig falla på ett namn ──────────────────────────
--
-- Triggern skapar profilraden i samma transaktion som användaren, så allt den
-- kastar sänker registreringen. Därför tar den ett upptaget namn och lägger
-- till en siffra i stället för att ge upp.
--
-- **Det är ett skyddsnät, inte flödet.** Den som registrerar sig i appen får
-- frågan om namnet är ledigt innan kontot skapas (punkt 3), och byter själv.
-- Kvar för nätet blir två fall där ingen valt något namn alls: Google-
-- inloggning, där namnet blir det som stod före `@` i mejladressen, och den
-- kapplöpning som uppstår när två personer registrerar samma namn i samma
-- sekund. I båda är en tyst siffra bättre än ett avbrutet konto — men i inget
-- av dem har någon skrivit namnet och fått det ändrat bakom ryggen.
--
-- Slingan räknar uppåt: `maja`, `maja2`, `maja3`. Efter femtio försök byts
-- taktiken mot en bit av användarens uuid — den kan inte kollidera, och femtio
-- varv betyder ändå att namnet inte är ett namn utan ett allmänord.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_name text;
  v_try  int := 1;
begin
  -- Redan skapad (triggern kördes om, eller raden kom någon annan väg):
  -- rör den inte. Utan den här raden hade slingan nedan tolkat krocken på
  -- primärnyckeln som en namnkrock och räknat siffror i evighet.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_base := nullif(trim(coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  )), '');
  v_base := coalesce(v_base, 'pauser');
  v_name := v_base;

  loop
    begin
      insert into public.profiles (id, username) values (new.id, v_name);
      return new;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 50 then
        insert into public.profiles (id, username)
        values (new.id, v_base || '-' || substr(new.id::text, 1, 8));
        return new;
      end if;
      v_name := v_base || v_try::text;
    end;
  end loop;
end;
$$;


-- ── 3. Frågan som går att ställa innan kontot finns ─────────────────────────
--
-- `security definer` och utdelad till `anon`, för den som ska ställa frågan är
-- per definition inte inloggad än.
--
-- **Den lämnar ut en sak: att ett exakt namn är taget.** Det är samma sorts
-- uppgift som undantaget i `search_profiles` redan ger ut — där korta namn går
-- att hitta genom att skriva dem helt och hållet — men här gäller det namn av
-- alla längder, och utan session. Priset är medvetet: alternativet är att
-- namnet bara kan testas genom att försöka skapa ett konto, och då betalar
-- varje krock med ett misslyckat konto i stället.
--
-- Vad den INTE lämnar ut är lika viktigt: inga rader, inga id:n, ingen lista.
-- Ett `true` eller ett `false` om en sträng man redan skrivit själv.

create or replace function public.username_available(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select trim(coalesce(p_name, '')) <> ''
     and not exists (
       select 1 from public.profiles
        where lower(username) = lower(trim(p_name))
     );
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
