// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,

  // global ignores
  {
    ignores: ["dist/*"],
  },

  // ✅ Cloud Functions: forbid impure bridge imports everywhere in functions/src ...
  {
    files: ["functions/src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "./core/bridge",
              message:
                "IMPURE import: only functions/src/index.ts may import ./core/bridge. Everyone else must use ./core/bridgePure.",
            },
            {
              name: "./core/bridge.ts",
              message:
                "IMPURE import: only functions/src/index.ts may import ./core/bridge.ts. Everyone else must use ./core/bridgePure.",
            },
            {
              name: "../core/bridge",
              message:
                "IMPURE import: do not import ../core/bridge here. Use ../core/bridgePure.",
            },
            {
              name: "../core/bridge.ts",
              message:
                "IMPURE import: do not import ../core/bridge.ts here. Use ../core/bridgePure.",
            },
            {
              name: "./bridge",
              message:
                "IMPURE import: do not import ./bridge here. Use ./bridgePure.",
            },
            {
              name: "./bridge.ts",
              message:
                "IMPURE import: do not import ./bridge.ts here. Use ./bridgePure.",
            },
          ],
        },
      ],

      // ✅ deine Stabilitäts-Schalter wegen kaputtem root tsconfig
      "import/namespace": "off",
      "import/named": "off",
    },
  },

  // ✅ ...except index.ts (Cloud Function entry is allowed to be impure)
  {
    files: ["functions/src/index.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);