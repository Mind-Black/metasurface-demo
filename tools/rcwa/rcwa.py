"""Minimal 2D RCWA (Fourier modal method) for a square lattice of circular pillars.

Normal incidence from the substrate, exit into air, exp(-i omega t) convention (a phase
delay is a positive phase). Run this file directly to validate the solver against the
exact complex transmission of a uniform slab.
"""
import numpy as np


def conv_mat(eps_grid, N):
    M = eps_grid.shape[0]
    F = np.fft.fft2(eps_grid)/M**2
    idx = np.arange(-N, N + 1)
    m, n = np.meshgrid(idx, idx, indexing='ij')
    m = m.ravel()
    n = n.ravel()
    return F[(m[:, None] - m[None, :]) % M, (n[:, None] - n[None, :]) % M]


def pillar_grid(p, d, eps_p, M=512, ss=4):
    """Area-averaged permittivity of a pillar of diameter d in a unit cell of pitch p."""
    c = (np.arange(M*ss) + .5)/(M*ss) - .5
    x = c*p
    X, Y = np.meshgrid(x, x, indexing='ij')
    f = (X**2 + Y**2 <= (d/2)**2).astype(float).reshape(M, ss, M, ss).mean(axis=(1, 3))
    return 1 + (eps_p - 1)*f


def rect_grid(p, L, W, eps_p, M=512, ss=4):
    """Area-averaged permittivity of a centred rectangular fin, length L along x and width W along y."""
    c = (np.arange(M*ss) + .5)/(M*ss) - .5
    x = c*p
    X, Y = np.meshgrid(x, x, indexing='ij')
    f = ((abs(X) <= L/2) & (abs(Y) <= W/2)).astype(float).reshape(M, ss, M, ss).mean(axis=(1, 3))
    return 1 + (eps_p - 1)*f


def forward(z):
    """Pick the square root that decays or propagates towards +z."""
    z = np.where(z.imag < 0, -z, z)
    return np.where((abs(z.imag) < 1e-12) & (z.real < 0), -z, z)


def solve(p, lam, h, eps_grid, eps_sub, N=7):
    k0 = 2*np.pi/lam
    idx = np.arange(-N, N + 1)
    m, n = np.meshgrid(idx, idx, indexing='ij')
    kx = (2*np.pi*m.ravel()/p)/k0 + 0j
    ky = (2*np.pi*n.ravel()/p)/k0 + 0j
    Kx, Ky = np.diag(kx), np.diag(ky)
    n2 = kx.size
    I = np.eye(n2)
    ER = conv_mat(eps_grid, N)
    iER = np.linalg.inv(ER)
    P = np.block([[Kx@iER@Ky, I - Kx@iER@Kx], [Ky@iER@Ky - I, -Ky@iER@Kx]])
    Q = np.block([[Kx@Ky, ER - Kx@Kx], [Ky@Ky - ER, -Ky@Kx]])
    lam2, W = np.linalg.eig(P@Q)
    gam = forward(np.sqrt(-lam2 + 0j))
    V = Q@W@np.diag(1/(1j*gam))

    def half_space(eps):
        kz = forward(np.sqrt(eps - kx**2 - ky**2 + 0j))
        Qh = np.block([[Kx@Ky, eps*I - Kx@Kx], [Ky@Ky - eps*I, -Ky@Kx]])
        return np.eye(2*n2), Qh@np.diag(1/(1j*np.r_[kz, kz])), kz

    W1, V1, kz1 = half_space(eps_sub)
    W2, V2, kz2 = half_space(1.0)
    X = np.exp(1j*gam*k0*h)
    n4 = 2*n2
    A = np.zeros((4*n4, 4*n4), complex)
    b = np.zeros((4*n4, 2), complex)
    inc = np.zeros((n4, 2), complex)
    c0 = n2//2
    inc[c0, 0] = 1       # x-polarized
    inc[n2 + c0, 1] = 1  # y-polarized
    A[0:n4, 0:n4] = -W1
    A[0:n4, n4:2*n4] = W
    A[0:n4, 2*n4:3*n4] = W*X
    b[0:n4] = W1@inc
    A[n4:2*n4, 0:n4] = V1
    A[n4:2*n4, n4:2*n4] = V
    A[n4:2*n4, 2*n4:3*n4] = -V*X
    b[n4:2*n4] = V1@inc
    A[2*n4:3*n4, n4:2*n4] = W*X
    A[2*n4:3*n4, 2*n4:3*n4] = W
    A[2*n4:3*n4, 3*n4:] = -W2
    A[3*n4:, n4:2*n4] = V*X
    A[3*n4:, 2*n4:3*n4] = -V
    A[3*n4:, 3*n4:] = -V2
    sol = np.linalg.solve(A, b)
    r, t = sol[:n4, 0], sol[3*n4:, 0]
    ty = sol[3*n4:, 1]

    def order_power(a, kz):
        ax, ay = a[:n2], a[n2:]
        az = -(kx*ax + ky*ay)/kz
        return kz.real*(abs(ax)**2 + abs(ay)**2 + abs(az)**2)

    kzi = kz1[c0].real
    Rord = order_power(r, kz1)/kzi
    Tord = order_power(t, kz2)/kzi
    # Power figures are for x-polarized incidence. Jones entries: t_ab = a-component for b-incidence.
    return dict(t00=t[c0], txx=t[c0], tyx=t[n2 + c0], txy=ty[c0], tyy=ty[n2 + c0],
                T00=Tord[c0], T=Tord.sum(), R=Rord.sum(), kzi=kzi)


def slab(n_sub, n, h, lam):
    """Exact complex transmission: substrate -> slab -> air."""
    k = 2*np.pi/lam
    r12 = (n_sub - n)/(n_sub + n)
    r23 = (n - 1)/(n + 1)
    e = np.exp(1j*k*n*h)
    return (2*n_sub/(n_sub + n))*(2*n/(n + 1))*e/(1 + r12*r23*e*e)


if __name__ == '__main__':
    for n_, lam, h in [(2.0, .532, .6), (2.67 + .1j, .532, .6), (1.3, .65, .3)]:
        s = solve(.25, lam, h, np.full((64, 64), n_**2, complex), 1.45**2, N=2)
        e = slab(1.45, n_, h, lam)
        print(f'n={n_}: |t00-exact|={abs(s["t00"]-e):.2e}  R+T={s["R"]+s["T"]:.6f}')
