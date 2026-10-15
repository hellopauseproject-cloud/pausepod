import { StyleSheet, View } from 'react-native';
import { usePalette } from '../contexts/ThemeContext';

/**
 * Progressring utan react-native-svg — det är en native-modul och hade krävt
 * en ny dev-build för ett enda element.
 *
 * Tekniken: två halvor som var för sig klipper bort sin sida av behållaren.
 * Inuti varje halva ligger en HEL cirkel där bara topp- och högerkanten är
 * färgade, alltså en halvmåne från klockan 12 medurs till 6. Den inre cirkeln
 * är lika stor som behållaren och ligger så att dess mittpunkt hamnar precis
 * på behållarens mitt — därför roterar den kring ringens centrum trots att RN
 * roterar kring elementets eget centrum, och ingen transformOrigin behövs.
 *
 * rotate = fraction * 360 - 180 för båda halvorna: höger halva är klar vid 50%
 * (rotate 0) och står stilla därefter, vänster halva börjar röra sig först då.
 * Därav klampningen i varje led.
 *
 * Ligger i en egen fil för att både Hem (dagens ring) och Kretsen (veckans)
 * ritar samma sak i olika storlekar. Geometrin är för lätt att ha sönder för
 * att finnas i två kopior.
 */
export function ProgressRing({
  fraction,
  size = 176,
  stroke = 9,
  muted,
  children,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const Palette = usePalette();
  const f = Math.max(0, Math.min(1, fraction));
  const half = size / 2;
  const sweep = f * 360 - 180;
  const color = muted ? Palette.ink18 : Palette.accent;

  // RN byter borderfärg längs kvadratens DIAGONALER, inte vid klockan 12 och
  // 6. "Topp + höger" är alltså bågen från 10:30 till 4:30 — 45° fel mot vad
  // svepet räknar med. Utan korrigeringen stack en kil in i den synliga halvan
  // redan vid noll, och varje annat värde låg snett.
  //
  // Korrigeringen ska vridas MEDURS (+45), så att bågen vid rotate 0 ligger
  // precis 12→6 och höger halva blir hel vid 50%. Stod länge på -45, vilket
  // vred den 90° fel: ringen började fyllas vid klockan 9 i stället för 12,
  // och över halva varvet föll den isär — 75% ritade en fjärdedel, 100%
  // ritade 12→3 plus 6→9 med hål emellan. Tecknet är hela skillnaden.
  const BORDER_SEAM = 45;

  const box = { width: size, height: size };
  const arcBase = {
    position: 'absolute' as const,
    top: 0,
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  };

  const arc = (side: 'left' | 'right', rotate: number) => (
    <View
      style={{
        position: 'absolute',
        top: 0,
        width: half,
        height: size,
        overflow: 'hidden',
        left: side === 'right' ? half : 0,
      }}
    >
      <View
        style={[
          arcBase,
          { left: side === 'right' ? -half : 0, borderTopColor: color, borderRightColor: color },
          { transform: [{ rotate: `${rotate}deg` }] },
        ]}
      />
    </View>
  );

  return (
    <View style={box}>
      <View
        style={{
          position: 'absolute',
          ...box,
          borderRadius: half,
          borderWidth: stroke,
          borderColor: Palette.ink07,
        }}
      />
      {/* Vid noll ritas ingen båge alls. Matematiken ger redan tom höger- och
          vänsterhalva där, men att inte rendera dem gör "tomt" till ett
          faktum i stället för ett resultat — inga kanter, inga delpixlar. */}
      {f > 0 && arc('right', (f <= 0.5 ? sweep : 0) + BORDER_SEAM)}
      {f > 0 && arc('left', (f <= 0.5 ? 0 : sweep) + BORDER_SEAM)}
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
        {children}
      </View>
    </View>
  );
}
