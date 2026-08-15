# Vendored QR encoder

`qrcodegen.mjs` is generated from Project Nayuki's `qrcodegen.ts`, release
`v1.8.0`, commit `720f62bddb7226106071d4728c292cb1df519ceb`:

<https://github.com/nayuki/QR-Code-generator/tree/v1.8.0/typescript-javascript>

The upstream source is MIT licensed. Its complete copyright and license notice
is preserved at the top of the generated file. The only local change is the
final ESM export used by `pairing-qr.mjs`.

Regeneration command (from the upstream `typescript-javascript` directory):

```sh
tsc --strict --lib DOM,DOM.Iterable,ES6 --target ES2022 --module ES2022 \
  --outDir out qrcodegen.ts
printf '\nexport { qrcodegen }\n' >> out/qrcodegen.js
```
