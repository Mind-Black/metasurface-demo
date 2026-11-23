# Optical Metasurfaces Visualizer

An interactive visualizer for optical metasurfaces, wavefields, and nanostructures.

## Phase profiles

Every single-function and two-function architecture supports arbitrary superpositions of five scalar phase profiles designed at $\lambda_0$:

- **Metalens**: hyperbolic focusing profile $\phi_{\text{lens}}(r) = -k_0(\sqrt{r^2 + f^2} - f)$.
- **Beam Deflector**: linear phase ramp $\phi_{\text{deflect}}(x) = k_0 \sin(\theta_0)\,x$.
- **Optical Vortex**: spiral azimuthal phase $\phi_{\text{vortex}}(r, \theta) = \ell\,\theta$ carrying orbital angular momentum $\ell\hbar$ per photon.
- **Axicon**: conical radial linear phase $\phi_{\text{axicon}}(r) = -k_0\,r\,\text{NA}_0$, where $\text{NA}_0 = \sin\theta_{a,0}$. Positive $\text{NA}_0$ converges incident waves into an extended non-diffracting Bessel beam over depth of focus $z_{\max}(\lambda) = (D/2)\cot\theta(\lambda)$ with an annular far-field ring at $\sin\theta = (\lambda/\lambda_0)|\text{NA}_0|$; negative $\text{NA}_0$ (or LCP incidence in Pancharatnam–Berry mode) produces a diverging hollow cone. Superposing an axicon with a vortex forms a higher-order $J_\ell$ Bessel beam; superposing it with a lens produces a ring focus in the focal plane.
- **CGH Hologram**: iterative Gerchberg–Saxton phase-only mask reconstructed in the far field.

## Two-function designs

The **Orthogonal channels** configuration assigns independent combinations of lens,
deflection, vortex, axicon, and hologram phase to an orthogonal pair of input polarizations.
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
