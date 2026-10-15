/**
 * Ett tak för hur mycket telefonens textstorlek får förstora appens text.
 *
 * Med textstorleken uppskruvad i telefonens inställningar flöt allt ut:
 * brickor med fast höjd, ringen på Hem, knappar och kort är byggda för text
 * som växer *lite*, inte tre gånger (iOS tillgänglighetsstorlekar går upp
 * till ~3,1×). Taket är `MAX_FONT_SCALE`: text växer med inställningen upp
 * till 1,3 gånger och stannar där. Det är Androids största vanliga steg och
 * strax under iOS största steg före tillgänglighetsstorlekarna — alltså
 * hela vägen för den som bara vill ha större text, men inte längre än att
 * layouten håller. En text som behöver mer kan sätta ett eget
 * `maxFontSizeMultiplier`; ett uttryckligt värde vinner alltid.
 *
 * **Varför en omskrivning av modulen och inte `Text.defaultProps`:** appen
 * kör React 19, som inte läser `defaultProps` på funktionskomponenter, och
 * React Natives `Text` och `TextInput` är numera sådana. Det vanliga
 * receptet gör alltså ingenting längre, utan att något felar.
 *
 * I stället byts modulernas `default` mot en tunn omslagskomponent. Det
 * fungerar eftersom `import { Text } from 'react-native'` läser
 * `require('./Libraries/Text/Text').default` vid varje åtkomst (getter i
 * react-native/index.js), så varje skärm får omslaget utan att ändras.
 *
 * **Det måste köras före allt annat** — en modul som fångat originalet vid
 * laddning (t.ex. `Animated.Text`) behåller det. Därför laddas filen från
 * appens egen startfil, [index.js](../index.js), före expo-router. Flyttas
 * `main` i package.json tillbaka till `expo-router/entry` försvinner taket
 * tyst.
 */
import { createElement } from 'react';

export const MAX_FONT_SCALE = 1.3;

function capModule(mod: { default?: unknown } | undefined) {
  const Original = mod?.default as any;
  if (!mod || !Original || Original.__fontScaleCapped) return;
  const Capped: any = (props: Record<string, unknown>) =>
    createElement(Original, { maxFontSizeMultiplier: MAX_FONT_SCALE, ...props });
  // Statiska fält (`TextInput.State` m.fl.) följer med.
  Object.assign(Capped, Original);
  Capped.displayName = Original.displayName ?? 'Text';
  Capped.__fontScaleCapped = true;
  mod.default = Capped;
}

try {
  /* eslint-disable @typescript-eslint/no-require-imports */
  capModule(require('react-native/Libraries/Text/Text'));
  capModule(require('react-native/Libraries/Components/TextInput/TextInput'));
  /* eslint-enable @typescript-eslint/no-require-imports */
} catch {
  // Går det inte (en framtida React Native som flyttat filerna) är appen
  // som förut — ostoppad text, men inget kraschar.
}
