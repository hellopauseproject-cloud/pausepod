import { readDoc, writeDoc } from '../lib/docStore';

// Filnamnet är oförändrat: på native skrivs samma fil på samma plats som förr,
// så befintliga installationer hittar sin profil. Se lib/docStore.ts för varför
// läsningen och skrivningen går via en omväg.
const PROFILE_DOC = 'userProfile.json';

export const saveProfile = async (name: string, photoUri: string | null) => {
  await writeDoc(PROFILE_DOC, JSON.stringify({ name, photoUri }));
};

export const getProfile = async (): Promise<{ name: string; photoUri: string | null }> => {
  try {
    const data = await readDoc(PROFILE_DOC);
    return JSON.parse(data);
  } catch (e) {
    return { name: 'Yourself', photoUri: null };
  }
};
