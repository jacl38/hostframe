# Local showcase assets

- `helvetiker-regular.json`: Helvetiker regular vector font from
  [Three.js](https://github.com/mrdoob/three.js/blob/dev/examples/fonts/helvetiker_regular.typeface.json).
  License and attribution are in `FONT-LICENSE.txt`.
- `rt-hdr-alb-nrm-small.tza`: Open Image Denoise small HDR model with albedo
  and normal guidance from
  [RenderKit/oidn-weights](https://github.com/RenderKit/oidn-weights/blob/master/rt_hdr_alb_nrm_small.tza).
  Apache 2.0 license in `OIDN-LICENSE.txt`.
  SHA-256: `980ea307e7825cae23ed8b1addf8de62ece84b61094795a5631ebf1c91b2e1a7`.

The examples read these files locally. No models, font files, denoising weights,
images or shaders are fetched at runtime. Scene geometry and HDR studio lighting
are generated in TypeScript.
