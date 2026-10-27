// box-tag: anropas av Pause Pod-boxen via WiFi.
//
// POST { "tag_uid": "9B3C31CA" }
// Header: x-box-id: BOX001, x-box-key: <boxens hemliga nyckel>
//
// Svar:
//   { status: "known",   username }                      taggen tillhör ett konto
//   { status: "unknown", code, url, expires_at }          visa QR-koden
//
// Boxen anropar samma sak igen med några sekunders mellanrum medan QR-koden
// visas. Så fort någon har kopplat taggen i appen svarar den "known".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const PAIR_URL = "https://joinpausepod.com/pair?code=";
const CODE_TTL_MINUTES = 5;
// Inga tecken som är lätta att blanda ihop (0/O, 1/I/L)
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ---- Boxen identifierar sig ----
  const boxId = req.headers.get("x-box-id") ?? "";
  const boxKey = req.headers.get("x-box-key") ?? "";
  if (!boxId || !boxKey) return json({ error: "missing_box_credentials" }, 401);

  const { data: box, error: boxError } = await admin
    .from("boxes")
    .select("id, key_hash, active")
    .eq("id", boxId)
    .maybeSingle();
  if (boxError) {
    console.error("box-tag: kunde inte läsa boxes", boxError);
    return json({ error: "db_error" }, 500);
  }
  if (!box || !box.active || box.key_hash !== (await sha256Hex(boxKey))) {
    console.warn(`box-tag: nekad låda ${boxId} (finns: ${!!box})`);
    return json({ error: "invalid_box" }, 401);
  }
  await admin.from("boxes").update({ last_seen_at: new Date().toISOString() }).eq("id", boxId);

  // ---- Vilken tagg? ----
  let body: { tag_uid?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const tagUid = (body.tag_uid ?? "").toUpperCase().replace(/[^0-9A-F]/g, "");
  if (tagUid.length < 8 || tagUid.length > 20) return json({ error: "invalid_tag_uid" }, 400);

  // ---- Känd tagg? ----
  // Via en definer-funktion: lådan ska kunna säga hej utan att funktionen
  // behöver läsrätt på hela profiles.
  const { data: username, error: ownerError } = await admin.rpc("tag_owner_username", {
    p_tag_uid: tagUid,
  });
  if (ownerError) {
    console.error("box-tag: kunde inte slå upp taggen", ownerError);
    return json({ error: "db_error" }, 500);
  }
  if (username) return json({ status: "known", username });

  // ---- Okänd: återanvänd en giltig kod, annars skapa en ny ----
  const now = new Date();
  const { data: existing } = await admin
    .from("tag_pairing_codes")
    .select("code, expires_at")
    .eq("box_id", boxId)
    .eq("tag_uid", tagUid)
    .is("claimed_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return json({
      status: "unknown",
      code: existing.code,
      url: PAIR_URL + existing.code,
      expires_at: existing.expires_at,
    });
  }

  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error } = await admin
      .from("tag_pairing_codes")
      .insert({ code, box_id: boxId, tag_uid: tagUid, expires_at: expiresAt });
    if (!error) {
      return json({ status: "unknown", code, url: PAIR_URL + code, expires_at: expiresAt });
    }
    if (error.code !== "23505") {
      console.error("box-tag: kunde inte skapa kod", error);
      return json({ error: "db_error" }, 500);
    }
  }
  return json({ error: "could_not_create_code" }, 500);
});
