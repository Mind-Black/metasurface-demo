# Optical Metasurfaces Visualizer

An interactive visualizer for optical metasurfaces, wavefields, and nanostructures.

## Two-function designs

The **Orthogonal channels** configuration assigns independent combinations of lens,
deflection, vortex, and hologram phase to an orthogonal pair of input polarizations.
The design basis is independent of the illuminating polarization. For a single layer
of linearly birefringent nanofins, the ideal response is
`J = Σ exp(i φj) conj(uj) uj†`: each input `uj` becomes its complex-conjugate output
with the assigned phase. Elliptical and circular states reverse handedness. The
Jones-vector gauge is fixed by making the largest Cartesian component real and
positive, preferring x in a tie; channel phases use that convention.

The **Dynamic + PB** configuration instead assigns a profile to each phase
contribution. With the existing `exp(-iωt)` convention, RCP is `(x + iy)/√2`.
An ideal half-wave fin produces RCP → LCP phase `D + PB + π/2` and LCP → RCP
phase `D - PB + π/2`, with fin angle `PB/2`. The `π/2` term is common to both
channels. These are two phase contributions, rather than two independently
selected channel functions.

**Ideal target** holds the design matrix fixed during wavelength scans as a
dispersion-free reference. **Library prediction** selects the best complex
Jones response from the tabulated TiO₂ nanofins at the design wavelength, then
keeps geometry fixed as illumination changes. Its transmission, undesired-channel
power, and Jones error are absolute aperture averages; far-field images are
normalized independently and are not efficiency measurements. Geometry displayed
in ideal mode is a candidate implementation, not a claim that the library exactly
realizes the target. Unsupported material, pitch, height, or wavelength choices
cannot produce a library prediction.

All field views use the same transmitted Jones aperture. Propagation treats its
two transverse components with the existing angular-spectrum approximation;
the library uses a local periodic approximation. Neither is a full-device Maxwell
simulation. See the [single-layer Jones-matrix constraints](https://pmc.ncbi.nlm.nih.gov/articles/PMC9729203/).

## Development

```bash
npm ci
npm run dev
npm test
npm run build
```

## GitHub Pages

Push to a GitHub repository with `main` as its default branch. In **Settings → Pages**, choose **GitHub Actions** as the source. The workflow builds and publishes the site on pushes to `main`, and can also be run from the Actions tab. The published address is shown in the workflow run and Pages settings.
