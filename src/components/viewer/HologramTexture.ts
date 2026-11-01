/** Share the complete phase mask with WebGL without large uniform arrays. */
export class HologramTexture {
  private texture: WebGLTexture | null;
  private lastMask: number[][] | null | undefined;

  constructor(private gl: WebGL2RenderingContext) {
    this.texture = gl.createTexture();
  }

  public bind(mask: number[][] | null, location: WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (mask !== this.lastMask) {
      const rows = mask?.length || 1;
      const cols = mask?.[0]?.length || 1;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cols, rows, 0, gl.RED, gl.FLOAT,
        mask ? new Float32Array(mask.flat()) : new Float32Array(1));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.lastMask = mask;
    }
    gl.uniform1i(location, 0);
  }

  public dispose(): void {
    this.gl.deleteTexture(this.texture);
  }
}
