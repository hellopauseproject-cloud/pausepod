// Skickar appens push-notiser vidare till Expo: kretsens dagsmål
// (supabase/circle_goal_notify.sql) och de fyra sociala
// (supabase/social_notify.sql). Namnet är kvar från när den var ensam — ett
// byte hade krävt en ny url i `notify_config`. Deployas med:
//
//   npx supabase functions deploy notify-circle-goal-reached --no-verify-jwt
//   npx supabase secrets set PAUSE_NOTIFY_SECRET=<samma sträng som i notify_config>
//
// `--no-verify-jwt` är inte en genväg förbi säkerheten. Anroparen är
// Postgres (`net.http_post` från `notify_circle_goal_reached` i
// supabase/circle_goal_notify.sql), och den har ingen användar-JWT att skicka.
// Spärren är i stället `x-pause-secret` nedan.
//
// ── Vad den medvetet INTE gör ───────────────────────────────────────────────
//
// Den talar aldrig med databasen. Mottagarlistan och texten räknas fram i SQL
// och kommer med i anropet. Följden är att funktionen inte behöver någon
// service-nyckel, inte kan läsa en profil, och inte kan skicka till någon som
// SQL:en inte redan valt — den är ett rör, inte ett beslut. Den gamla
// `notify-friends-pausing` gjorde motsatsen och slog upp mottagarna själv.
//
// Den loggar heller aldrig innehållet i en notis utöver antalet tokens. Det
// finns inget personligt i den här texten (ett användarnamn och en fast
// mening), men vanan hör ihop med regeln i CLAUDE.md om att ingen text
// dubbleras någon annanstans.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expos tak per anrop. Större listor än så delas upp. */
const BATCH_SIZE = 100;

/**
 * Kanalerna appen skapar, en per sorts notis — `PUSH_CHANNELS` i
 * lib/notifications.ts. Egna kanaler gör att den som bara vill tysta chatten
 * kan göra det i Androids inställningar utan att tysta resten.
 */
const CHANNELS = new Set([
  'circle-goal-reached',
  'circle-chat',
  'support-request',
  'support-received',
  'pause-invite',
]);

type Payload = {
  tokens: unknown;
  title: unknown;
  body: unknown;
  data?: unknown;
  channel?: unknown;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async req => {
  if (req.method !== 'POST') {
    return json(405, { error: 'POST only' });
  }

  const secret = Deno.env.get('PAUSE_NOTIFY_SECRET');
  if (!secret) {
    // Hellre ett tydligt fel än att skicka utan spärr. En funktion utan
    // hemlighet är öppen för vem som helst som hittar url:en.
    return json(500, { error: 'PAUSE_NOTIFY_SECRET is not set' });
  }
  if (req.headers.get('x-pause-secret') !== secret) {
    return json(401, { error: 'bad secret' });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'invalid json' });
  }

  const { tokens, title, body, data, channel } = payload;
  // Okänd eller saknad kanal faller tillbaka på dagsmålets: SQL:en för
  // dagsmålet skickar ingen, och en stavning som inte finns i appen hade
  // annars hamnat i Androids standardkanal utan namn.
  const channelId =
    typeof channel === 'string' && CHANNELS.has(channel) ? channel : 'circle-goal-reached';
  if (!Array.isArray(tokens) || typeof title !== 'string' || typeof body !== 'string') {
    return json(400, { error: 'tokens[], title and body are required' });
  }

  // Dubbletter filtreras bort: samma konto inloggat på två telefoner har två
  // rader i profiles? Nej — men en token kan ha hunnit skrivas om och ligga
  // kvar, och Expo räknar varje förekomst som ett utskick.
  const recipients = [...new Set(tokens.filter((t): t is string => typeof t === 'string' && !!t))];
  if (recipients.length === 0) {
    return json(200, { sent: 0 });
  }

  const results: unknown[] = [];

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const messages = recipients.slice(i, i + BATCH_SIZE).map(to => ({
      to,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      // Androids kanal måste finnas i appen, annars hamnar notisen i
      // standardkanalen. Kanalerna skapas av ensurePushChannels() i
      // lib/notifications.ts och heter likadant där (`PUSH_CHANNELS`).
      channelId,
      // Samlar notiserna under ett och samma huvud i notisfältet i stället
      // för att lägga dem som enskilda rader. Nådde tre medlemmar sitt mål
      // samma kväll ser mottagaren en grupp, inte tre separata knackningar —
      // det är den närmaste motsvarigheten till buntning som går att få utan
      // att hålla ett eget tillstånd per mottagare.
      categoryId: channelId,
      threadId: channelId,
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });
      results.push(await res.json());
    } catch (e) {
      // En fallen batch fäller inte de andra, och fäller framför allt inte
      // pausen som utlöste anropet: `net.http_post` är asynkron och ingen i
      // appen väntar på svaret.
      results.push({ error: String(e) });
    }
  }

  console.log(`notify-circle-goal-reached [${channelId}]: ${recipients.length} mottagare`);
  return json(200, { sent: recipients.length, results });
});
