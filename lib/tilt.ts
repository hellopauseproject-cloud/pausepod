// Delad mellan placeinbox.tsx (nedläggning) och _layout.tsx (lyft). Mäter
// lutning mot tyngdkraften istället för rotation.beta/gamma — beta ensam
// missar en telefon som står på högkant, och rotation-enheterna skiljer sig
// mellan iOS och Android. Vinkeln mot g är oberoende av båda.
export function tiltDegrees(g: { x: number; y: number; z: number }): number | null {
  const mag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
  if (mag < 0.1) return null;
  // 0° = helt platt (skärmen upp eller ner), 90° = står på kant.
  return Math.acos(Math.min(1, Math.abs(g.z) / mag)) * (180 / Math.PI);
}

// Positivt g.z betyder skärmen nedåt — på BÅDA plattformarna, hur
// kontraintuitivt det än ser ut för Android. iOS rapporterar CoreMotions
// userAcceleration + gravity, och gravity.z är −1 med skärmen uppåt.
// Androids accelerometer mäter tvärtom proper acceleration och ger +9,81
// med skärmen uppåt — men expo-sensors skickar inte det råvärdet vidare,
// utan räknar `TYPE_ACCELEROMETER − 2 × TYPE_GRAVITY` (se eventsToMap i
// DeviceMotionModule.kt). Subtraktionen vänder just gravitationsdelen och
// lägger Android på iOS konvention. Att teckenvända per plattform här vore
// alltså att införa felet, inte rätta det.
//
// cos(31,8°) — hur snett telefonen får ligga och ändå räknas som nedåtvänd.
// Generöst nog för ett ojämnt bord eller en kameraknöl, snålt nog för att
// en telefon på högkant eller i handen aldrig ska passera.
const FACE_DOWN_MIN_PROJECTION = 0.85;

/** Ligger telefonen med skärmen nedåt? null när avläsningen är för svag
 *  för att säga något (fritt fall, sensorbrus). */
export function isFaceDown(g: { x: number; y: number; z: number }): boolean | null {
  const mag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
  if (mag < 0.1) return null;
  return g.z / mag >= FACE_DOWN_MIN_PROJECTION;
}
