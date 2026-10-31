import assert from "node:assert/strict";

export function checkAdapter(adapter: GPUAdapter) {
  const info = adapter.info;
  console.log(`Adapter: ${info.vendor}, ${info.device}, ${info.description}; fallback: ${info.isFallbackAdapter}`);
  const expectedVendor = process.env.TS_DAWN_EXPECT_VENDOR;
  if(expectedVendor !== undefined) {
    assert.equal(info.vendor, expectedVendor, "Unexpected GPU vendor");
    assert.equal(info.isFallbackAdapter, false, "Hardware verification forbids a software adapter");
  }
}
