import type { OpticsState } from '@/lib/store/useOpticsStore';
import type { FarFieldInput, FarFieldResult } from './farField';
import type { FieldWindow } from './propagation';

export type FieldKind = 'xy' | 'xz' | 'overview' | 'far';

export interface FieldRequest {
  kind: FieldKind;
  device: FarFieldInput;
  halfX: number;   // ±x [µm], or ±sinθ for far
  halfV: number;   // ±y for xy; zMax for xz and overview [µm]; unused for far
  nx: number;
  nv: number;
  z?: number;      // plane for xy [µm]
}

export interface FieldReply {
  request: FieldRequest;
  field?: FieldWindow;
  far?: FarFieldResult;
  error?: string;
}

type Callback = (reply: FieldReply) => void;

export function deviceFromState(state: OpticsState): FarFieldInput {
  const gradients = state.activeGradients;
  return {
    wavelength: state.wavelength,
    designWavelength: state.designWavelength,
    focalLength: state.focalLength,
    diameter: state.diameter,
    deflectionAngle: state.deflectionAngle,
    topologicalCharge: state.topologicalCharge,
    ...gradients,
    // The mask is only read in hologram mode; leaving it out saves cloning it into the worker.
    cghPhaseMask: gradients.hologram ? state.cghPhaseMask : null,
  };
}

/** Runs field solves off the main thread. Each kind keeps one job running and only the latest waiting. */
class FieldClient {
  private worker: Worker | null = null;
  private running = new Map<FieldKind, Callback>();
  private waiting = new Map<FieldKind, { request: FieldRequest; callback: Callback }>();

  /** Creates the worker ahead of the first request. */
  warm(): void {
    this.getWorker();
  }

  request(request: FieldRequest, callback: Callback): void {
    if (this.running.has(request.kind)) {
      this.waiting.set(request.kind, { request, callback });
      return;
    }
    this.running.set(request.kind, callback);
    this.getWorker().postMessage(request);
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./fieldWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<FieldReply>) => {
        const { kind } = event.data.request;
        const callback = this.running.get(kind);
        this.running.delete(kind);
        const next = this.waiting.get(kind);
        if (next) {
          this.waiting.delete(kind);
          this.request(next.request, next.callback);
        }
        callback?.(event.data);
      };
      this.worker.onerror = (event) => console.error('Field worker error:', event.message);
    }
    return this.worker;
  }
}

export const fieldClient = new FieldClient();
