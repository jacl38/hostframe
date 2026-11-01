import type * as Native from "../../../build/native/generated/native";
import type { InputEvent, WindowOptions, Window } from "../../../index.ts";
import { Key, Modifier, PointerButton } from "../../../index.ts";

function inputConstantContracts() {
  const zero: 48 = Key.ZERO;
  const shift: 340 = Key.LEFT_SHIFT;
  const keypadZero: 320 = Key.KP_0;
  const left: 0 = PointerButton.LEFT;
  const first: typeof left = PointerButton.ONE;
  const modifier: 1 = Modifier.SHIFT;
  void [zero, shift, keypadZero, first, modifier];
  // @ts-expect-error GLFW suffixes retain their original spelling.
  void Key.LeftShift;
  // @ts-expect-error Standalone digits use word names.
  void Key.Digit0;
  // @ts-expect-error LAST is a sentinel, not another key.
  void Key.LAST;
}
void inputConstantContracts;

// Compiled by the required typecheck; these contracts must be generated without
// widening WebGPU objects, synchronous returns, discriminants or readonly fields.
function nativeContracts(app: Native.Application, device: GPUDevice, publicWindow: Window) {
  const options: WindowOptions = { width: 640, resizable: true, vsync: false };
  const window = app.createWindow(device, options);
  app.createWindow(device);
  app.createWindow(device, undefined);
  publicWindow.draw(texture => {
    const gpuTexture: GPUTexture = texture;
    gpuTexture.createView();
  });
  // @ts-expect-error The public wrapper must retain the generated synchronous contract.
  publicWindow.draw(async () => {});
  // @ts-expect-error A device must remain Dawn's WebGPU device type.
  app.createWindow({});
  // @ts-expect-error Draw callbacks must return undefined synchronously.
  window.draw(async () => {});
  // @ts-expect-error Arbitrary callback results are forbidden.
  window.draw(() => 1);
  // @ts-expect-error Native state properties remain read-only.
  window.disposed = false;
  window.dispatchInput((state, events) => {
    // @ts-expect-error Snapshot arrays remain read-only.
    state.keys.push(1);
    // @ts-expect-error Input callbacks must see immutable state.
    state.focused = true;
    for(const event of events) {
      const publicEvent: InputEvent = event;
      if(publicEvent.type === "key") {
        const key: number = publicEvent.key;
        void key;
        // @ts-expect-error Discriminated input events must not widen to arbitrary objects.
        void publicEvent.deltaX;
      }
    }
  });
  // @ts-expect-error Input callbacks must be synchronous too.
  window.dispatchInput(async () => {});
}
void nativeContracts;
