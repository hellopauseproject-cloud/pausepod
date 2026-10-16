/**
 * Androids navigeringsfält under en lådlös paus.
 *
 * Medan klockan går är fältet gömt, så att hemknappen inte går att nå utan
 * att först svepa fram fältet — och det svepet ser appen. Ett bord sveper
 * aldrig, så ett fält som kommer fram medan klockan går är samma bevis som en
 * beröring: telefonen är i en hand (se `freezeInHand` i app/pausing.tsx).
 *
 * **Den nativa modulen läses valfritt.** `expo-navigation-bar` kräver en ny
 * dev-build, och en import av paketet kastar redan vid laddning i en build
 * som saknar modulen — då hade pausskärmen dött. Med
 * `requireOptionalNativeModule` blir allt här en tyst no-op tills telefonen
 * har en build med modulen.
 *
 * **Beteendet sätts direkt på modulen.** Paketets `setBehaviorAsync` vägrar
 * med edge-to-edge påslaget (bara en varning), men det nativa anropet gör
 * bara `systemBarsBehavior = …`. `inset-swipe` är valt för att fältet då
 * stannar framme efter svepet och appen får veta det. `overlay-swipe`
 * visar fältet tillfälligt *ovanpå* appen, och då kommer ingen händelse.
 *
 * Bara Android: iOS hemindikator går inte att gömma så att svepet syns för
 * appen.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type NavBarVisibility = 'visible' | 'hidden';

type NavBarModule = {
  setVisibilityAsync(visibility: NavBarVisibility): Promise<void>;
  setBehaviorAsync(behavior: 'inset-swipe'): Promise<void>;
  addListener(
    event: 'ExpoNavigationBar.didChange',
    listener: (e: { visibility: NavBarVisibility }) => void,
  ): { remove(): void };
};

const NavBar = Platform.OS === 'android'
  ? requireOptionalNativeModule<NavBarModule>('ExpoNavigationBar')
  : null;

/** Finns modulen i den här builden? */
export const navBarGuardAvailable = NavBar !== null;

export function hideNavBar(): void {
  if (!NavBar) return;
  NavBar.setBehaviorAsync('inset-swipe')
    .then(() => NavBar.setVisibilityAsync('hidden'))
    .catch(e => console.log('NavBar: kunde inte gömma fältet:', e));
}

export function showNavBar(): void {
  if (!NavBar) return;
  NavBar.setVisibilityAsync('visible').catch(() => {});
}

/** Anropas när fältet kommer fram. Händelsen kommer också när appen själv
 *  visar det — anroparen avgör om det var en hand. */
export function onNavBarShown(listener: () => void): () => void {
  if (!NavBar) return () => {};
  const sub = NavBar.addListener('ExpoNavigationBar.didChange', e => {
    if (e.visibility === 'visible') listener();
  });
  return () => sub.remove();
}
