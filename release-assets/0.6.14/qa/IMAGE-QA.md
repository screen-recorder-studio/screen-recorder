# Chrome Web Store Image QA — 0.6.14

Checked: 2026-08-30

## Result

- 20/20 expected store screenshots exist.
- 20/20 are 1280 × 800 RGB JPEG files with no alpha channel.
- Four localized sequences use the same five-scene order and restrained Winter Neva background.
- Individual full-resolution and 640 × 400 inspection found no editor selection borders, control points, notifications, sync banners, cursor artifacts, clipping, or unresolved text-image overlap.
- The first-pass editor controls, Russian screen 02 overlap, and English screen 05 overlap were found during review and corrected before this final set.
- Screen 02 now exposes the Studio timeline; screen 03 uses a real four-second GIF setup with a green email-friendly estimate of about 112.5–562.5 KB.
- Three independent final reviewers returned GO for visual quality, localization, and store conversion readiness.
- Combined review sheet: `contact-sheet-all-locales.jpg`.

## SHA-256

```text
en/01-area-to-gif.jpg  74e4edbc3aa910aa17f35c0ee9c0375db5b179221ab47d5e78183342062ffaa9
en/02-studio-workflow.jpg  2f7a9c150a867ac82874875250fa85f4c03c1404a204884393d16f571145f862
en/03-gif-export.jpg  458255affb1d6a6139580c64febd13129d063d925aaa42b9c2f13562283bca27
en/04-video-export.jpg  3b0a89dacf774c98dc3c54c1ee85f11fc9acd6b335c4a60011c47f1051c3bbe7
en/05-local-library.jpg  aa8fc01a40983a5b095ef0cde002987ae911df100a37668b6a5a7e25b9e8e9ad
ru/01-area-to-gif.jpg  cc538ef4a71d5470ffc57da3537f6c6e68e85004e34a02b61cd6ab6393ec9d8b
ru/02-studio-workflow.jpg  bb9730506304436507df69e95f8777919860f4d6ff2fdb7bc36e294c854b676d
ru/03-gif-export.jpg  339250594074c86a14ed9877e8bc715c8eacd672cfc8a920080254ddba40fb74
ru/04-video-export.jpg  2f0afaf872e3fa719daa57b56c285e274e2a93fbdff8f4d5ba39cf4fcf66290e
ru/05-local-library.jpg  cc437a485c52fb5ff62d350174e44337fbdec1b545eb0b95ac6947df8fb3e878
zh-CN/01-area-to-gif.jpg  9c7e946514dba9a6d4757096f8883931381289ef94a3169f4c8a833ddb2156e6
zh-CN/02-studio-workflow.jpg  c028e4243006a7f4c69a6472be1c97aa88c3ec335b54d94a7b96b51fb4cab380
zh-CN/03-gif-export.jpg  075110d0675ef58d48fa0c2362bcbee94053abe938609624b5fd7283d26f8bda
zh-CN/04-video-export.jpg  3aecfd0e658468f7cebdd81f9009a468d9c8a37fb5a6377cddc00950c9bb101f
zh-CN/05-local-library.jpg  3220b224d82301926da055e3b9307f16dbb63bbab145831b265297adf0ed3c4b
zh-TW/01-area-to-gif.jpg  aee67f9d25b35e45d5701d537cd4551bb986431ecdcf8747d93af4cbf295cd22
zh-TW/02-studio-workflow.jpg  92972389aeeb49aa4abebad8b08f317216fbe3faf87e9df4c7113ccaf7623fe9
zh-TW/03-gif-export.jpg  67ec2e20a705ccebeff1cf5715c128efd85e0dca2c4a1dc25baf5b0cac12c020
zh-TW/04-video-export.jpg  fb3a9da92d1169ef8659cb714e19533f8f78da6b8a70b2612895976f4b65cb63
zh-TW/05-local-library.jpg  1fd0dd8d62337bbbb7e3efe032337312d759335627da26362f338dc20f20b1fc
```
