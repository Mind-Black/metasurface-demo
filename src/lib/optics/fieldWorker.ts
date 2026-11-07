import { computeFarField } from './farField';
import { computeXY, computeXZ, FieldWindow } from './propagation';
import { phaseResponse } from './rcwaLut';
import type { FieldReply, FieldRequest } from './fieldClient';

const worker = self as unknown as Worker;

// Build the default device's phase response while the page is still loading.
phaseResponse(0.532, 0.532);

function solve(request: FieldRequest): FieldWindow {
  const { device, halfX, halfV, nx, nv, z } = request;
  return request.kind === 'xy'
    ? computeXY(device, z ?? 0, halfX, halfV, nx, nv)
    : computeXZ(device, halfX, halfV, nx, nv);
}

const DEVICE_NUMBERS = ['wavelength', 'designWavelength', 'focalLength', 'diameter', 'deflectionAngle', 'topologicalCharge'] as const;

/** A request with a non-finite window or device would burn a full solve to produce NaNs. */
function validate(request: FieldRequest): string | null {
  const { device, halfX, halfV, nx, nv, z } = request;
  if (![halfX, nx, z ?? 0].every(Number.isFinite) || !(nx > 0)) return 'non-finite or empty window';
  if (request.kind !== 'far' && (!Number.isFinite(halfV) || !(nv > 0))) return 'non-finite or empty window';
  if (!DEVICE_NUMBERS.every((key) => Number.isFinite(device[key]))) return 'non-finite device';
  return null;
}

worker.onmessage = (event: MessageEvent<FieldRequest>) => {
  const error = validate(event.data);
  if (error) {
    worker.postMessage({ request: event.data, error } satisfies FieldReply);
    return;
  }
  if (event.data.kind === 'far') {
    const far = computeFarField(event.data.device, event.data.nx, event.data.halfX);
    const reply: FieldReply = { request: event.data, far };
    worker.postMessage(reply, [far.intensity.buffer, far.real.buffer, far.imaginary.buffer]);
    return;
  }
  const field = solve(event.data);
  const reply: FieldReply = { request: event.data, field };
  worker.postMessage(reply, [field.data.buffer]);
};
