import * as FileSystem from 'expo-file-system/legacy';

const PROFILE_PATH = FileSystem.documentDirectory + 'userProfile.json';

export const saveProfile = async (name: string, photoUri: string | null) => {
  await FileSystem.writeAsStringAsync(PROFILE_PATH, JSON.stringify({ name, photoUri }));
};

export const getProfile = async (): Promise<{ name: string; photoUri: string | null }> => {
  try {
    const data = await FileSystem.readAsStringAsync(PROFILE_PATH);
    return JSON.parse(data);
  } catch (e) {
    return { name: 'Dig själv', photoUri: null };
  }
};