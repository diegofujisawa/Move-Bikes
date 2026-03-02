import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";


export default [
  {ignores: ["dist/**"]},
  {files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"]},
  {languageOptions: { globals: globals.browser }},
  ...tseslint.configs.recommended,
  {plugins: {react: pluginReact}},
  {
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/jsx-no-target-blank": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
