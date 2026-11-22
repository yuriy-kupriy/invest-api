// HW #32 gate, step 1 (with tsc --noEmit): the recommended set for the app code.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'infra/**', 'node_modules/**', 'graphify-out/**'] },
  {
    files: ['src/**/*.ts', 'gates/fixtures/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
);
