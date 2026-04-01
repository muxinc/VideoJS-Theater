declare global {
  interface Navigator {
    gpu: any;
  }

  const GPUTextureUsage: any;
  const GPUBufferUsage: any;

  type GPUAdapter = any;
  type GPUDevice = any;
  type GPUBuffer = any;
  type GPUTexture = any;
  type GPUTextureView = any;
  type GPUSampler = any;
  type GPUBindGroup = any;
  type GPUBindGroupLayout = any;
  type GPUShaderModule = any;
  type GPURenderPipeline = any;
  type GPUCanvasContext = any;
  type GPUCommandEncoder = any;
  type GPURenderPassEncoder = any;
  type GPUExternalTexture = any;
}

export {};
