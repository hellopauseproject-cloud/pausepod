// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // supabase/functions körs av Deno hos Supabase, inte av Metro: den har
    // egna globaler (Deno) och importerar över jsr:/https:. Både den här
    // konfigurationen och tsconfig.json hoppar över mappen av samma skäl.
    ignores: ['dist/*', 'supabase/functions/*'],
  },
]);
