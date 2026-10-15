// Appens startfil. Taket för telefonens textstorlek måste laddas före allt
// annat — se lib/fontScaleCap.ts. Därefter startar expo-router som vanligt.
import './lib/fontScaleCap';
import 'expo-router/entry';
