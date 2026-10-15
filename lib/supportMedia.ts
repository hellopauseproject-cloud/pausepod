import { supabase } from './supabase';

const SUPABASE_URL = 'https://iwyumzgewiwvcbuqzjnk.supabase.co';
const BUCKET = 'support-media';

/**
 * Laddar upp en lokal fil (`file://…`) till `support-media` och returnerar den
 * publika URL:en. Rösten, videon och fotot delar den här — tre kopior av
 * samma trettio rader hade glidit isär, och det är just en sådan kopia som
 * bar bucket-namnet och URL:en på var sitt ställe. Samma skäl som
 * `duration-wheel.tsx` och `intro-chrome.tsx` finns för.
 *
 * XHR + FormData och inte `supabase.storage.upload()`: klienten vill ha en
 * Blob eller en ArrayBuffer, och React Natives `fetch` mot en `file://`-URI
 * ger en tom sådan på Android. FormData med `{ uri }` är den väg RN:s
 * nätverkslager självt kan läsa filen från disk.
 */
export async function uploadSupportMedia(
  localUri: string,
  storagePath: string,
  mimeType: string,
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not logged in');

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    const form = new FormData();
    form.append('', { uri: localUri, type: mimeType, name: storagePath.split('/').pop() ?? 'file' } as any);
    xhr.send(form);
  });

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}
