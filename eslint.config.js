// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,

  // global ignores (final)
  {
    ignores: [
      "**/node_modules/**",
      "**/lib/**", // functions build output (tsc -> lib)
      "**/dist/**",
      "**/build/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/.firebase/**",
      "**/.cache/**",
      "**/coverage/**",
      "**/*.min.js",
    ],
  },

  // ✅ Cloud Functions: forbid impure bridge imports everywhere in functions/src ...
  {
    files: ["functions/src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            // ---- disallow importing impure bridge from anywhere except allowed entrypoints ----
            {
              name: "./core/bridge",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },
            {
              name: "./core/bridge.ts",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },

            {
              name: "../core/bridge",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },
            {
              name: "../core/bridge.ts",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },

            {
              name: "../../core/bridge",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },
            {
              name: "../../core/bridge.ts",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },

            {
              name: "../../../core/bridge",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },
            {
              name: "../../../core/bridge.ts",
              message:
                "IMPURE import: only entrypoints may import bridge. Use bridgePure elsewhere.",
            },

            {
              name: "./bridge",
              message: "IMPURE import: do not import ./bridge here. Use ./bridgePure.",
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

  // ✅ ...except ONLY index.ts (index.ts is the ONLY impure surface)
{
  files: [
    "functions/src/index.{ts,tsx,js,jsx}",
  ],
  rules: {
    "no-restricted-imports": "off",
  },
},
]);