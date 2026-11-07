import { computeFarField } from './farField';
import { computeXY, computeXZ, FieldWindow } from './propagation';
import type { FieldReply, FieldRequest } from './fieldClient';

const worker = self as unknown as Worker;

function solve(request: FieldRequest): FieldWindow {
  const { device, halfX, halfV, nx, nv, z } = request;
  return request.kind === 'xy'
    ? computeXY(device, z ?? 0, halfX, halfV, nx, nv)
    : computeXZ(device, halfX, halfV, nx, nv);
}

worker.onmessage = (event: MessageEvent<FieldRequest>) => {
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
