// Stubs .css imports as empty modules so plain-node tests can import
// renderer modules (src/fonts.js pulls in @fontsource CSS at the top).
// Register from a test with:
//   import { register } from 'node:module';
//   register('./css-stub-loader.mjs', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: '', shortCircuit: true };
  }
  return next(url, context);
}
